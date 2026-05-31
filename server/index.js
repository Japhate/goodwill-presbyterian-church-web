import express from 'express';
import fs from 'fs';
import path from 'path';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { initializeApp, getApps } from 'firebase/app';
import { doc, getDoc, getFirestore } from 'firebase/firestore';
import {
  getDefaultEmailTemplate,
  mergeEmailTemplate,
  NEWSLETTER_TEMPLATE_IDS,
  renderNewsletterTemplateText,
} from '../src/lib/newsletterTemplates.js';

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const CANONICAL_HOST = 'www.goodwillpres.org';
const LEGACY_HOSTS = new Set([
  'goodwillpresch1867.com',
  'www.goodwillpresch1867.com',
  'goodwillpresch1867.org',
  'www.goodwillpresch1867.org',
]);

app.use((req, res, next) => {
  const host = req.hostname?.toLowerCase();

  if (LEGACY_HOSTS.has(host)) {
    return res.redirect(301, `https://${CANONICAL_HOST}${req.originalUrl}`);
  }

  next();
});

app.use(cors());
app.use(express.json({ limit: '15mb' }));

const DATA_DIR = path.join(ROOT_DIR, 'server', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function readEntity(entityName) {
  const file = path.join(DATA_DIR, `${entityName}.json`);
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) || [];
  } catch (e) {
    return [];
  }
}

function writeEntity(entityName, data) {
  const file = path.join(DATA_DIR, `${entityName}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizePersonName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ');
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getFirebaseServerConfig() {
  const config = {
    apiKey: process.env.VITE_FIREBASE_API_KEY,
    authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.VITE_FIREBASE_APP_ID,
  };

  return Object.values(config).every(Boolean) ? config : null;
}

function getServerFirestore() {
  const config = getFirebaseServerConfig();
  if (!config) return null;

  const app = getApps().find((firebaseApp) => firebaseApp.name === 'server') || initializeApp(config, 'server');
  return getFirestore(app);
}

function decodeBase64UrlJson(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), '=');
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
}

async function assertAdminRequest(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    const error = new Error('Admin authorization is required.');
    error.status = 401;
    throw error;
  }

  const config = getFirebaseServerConfig();
  if (!config?.projectId) {
    const error = new Error('Firebase project configuration is missing on the server.');
    error.status = 500;
    throw error;
  }

  let payload;
  try {
    payload = decodeBase64UrlJson(token.split('.')[1]);
  } catch {
    const error = new Error('Invalid admin authorization token.');
    error.status = 401;
    throw error;
  }

  const uid = payload?.sub || payload?.user_id;
  if (!uid || payload?.aud !== config.projectId) {
    const error = new Error('Invalid admin authorization token.');
    error.status = 401;
    throw error;
  }

  const adminUrl = `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/(default)/documents/admins/${encodeURIComponent(uid)}`;
  const response = await fetch(adminUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const error = new Error('This account is not authorized to send newsletter broadcasts.');
    error.status = response.status === 404 ? 403 : response.status;
    throw error;
  }

  return { uid, email: payload.email || '' };
}

async function readEmailTemplate(templateId) {
  const defaultTemplate = getDefaultEmailTemplate(templateId);

  try {
    const db = getServerFirestore();
    if (db) {
      const snapshot = await getDoc(doc(db, 'EmailTemplates', templateId));
      if (snapshot.exists()) {
        return mergeEmailTemplate({ ...snapshot.data(), id: snapshot.id }, templateId);
      }
    }
  } catch (error) {
    console.warn('Unable to read email template from Firestore', error?.message || error);
  }

  const localTemplate = readEntity('EmailTemplates').find((template) => template.id === templateId);
  return mergeEmailTemplate(localTemplate || defaultTemplate, templateId);
}

function linkifyEscapedText(escapedText, variables) {
  let text = escapedText;
  const escapedUnsubscribeUrl = escapeHtml(variables.unsubscribeUrl);
  const escapedSupportEmail = escapeHtml(variables.supportEmail);
  const escapedSupportPhone = escapeHtml(variables.supportPhone);

  if (escapedUnsubscribeUrl) {
    text = text.replaceAll(
      escapedUnsubscribeUrl,
      `<a href="${escapedUnsubscribeUrl}" style="color:#8a5a16;font-weight:bold;text-decoration:underline;">Unsubscribe</a>`
    );
  }

  if (escapedSupportEmail) {
    text = text.replaceAll(
      escapedSupportEmail,
      `<a href="mailto:${escapedSupportEmail}" style="color:#8a5a16;font-weight:bold;text-decoration:underline;">${escapedSupportEmail}</a>`
    );
  }

  if (escapedSupportPhone) {
    text = text.replaceAll(
      escapedSupportPhone,
      `<a href="tel:${escapedSupportPhone}" style="color:#8a5a16;font-weight:bold;text-decoration:underline;">${escapedSupportPhone}</a>`
    );
  }

  return text.replaceAll('\n', '<br />');
}

function renderEmailTextBlock(text, variables, options = {}) {
  const rendered = renderNewsletterTemplateText(text, variables);
  return rendered
    .split(/\n{2,}/)
    .filter((paragraph) => paragraph.trim())
    .map((paragraph) => {
      const content = linkifyEscapedText(escapeHtml(paragraph), variables);
      const style = options.highlight
        ? 'font-size:16px;line-height:1.6;margin:0 0 22px;background:#fff7ed;border-left:4px solid #d97706;padding:14px 16px;'
        : 'font-size:16px;line-height:1.6;margin:0 0 18px;';
      return `<p style="${style}">${content}</p>`;
    })
    .join('');
}

async function buildNewsletterEmail({ templateId, email, firstName = '', lastName = '', unsubscribeUrl = '' }) {
  const template = await readEmailTemplate(templateId);
  const variables = {
    email,
    firstName,
    lastName,
    unsubscribeUrl,
    supportPhone: template.support_phone || '',
    supportEmail: template.support_email || '',
  };
  const subject = renderNewsletterTemplateText(template.subject, variables);
  const heading = renderNewsletterTemplateText(template.heading, variables);
  const bodyHtml = renderEmailTextBlock(template.body, variables);
  const footerHtml = renderEmailTextBlock(template.footer, variables);
  const text = [
    renderNewsletterTemplateText(template.body, variables),
    renderNewsletterTemplateText(template.footer, variables),
  ].filter(Boolean).join('\n\n');

  return {
    subject,
    heading,
    html: `
      <div style="margin:0;padding:0;background:#f8f3ea;font-family:Arial,Helvetica,sans-serif;color:#2f241c;">
        <div style="max-width:640px;margin:0 auto;padding:32px 18px;">
          <div style="background:#ffffff;border:1px solid #eadcc7;border-radius:12px;overflow:hidden;">
            <div style="background:#4b342a;color:#ffffff;padding:24px 28px;">
              <h1 style="margin:0;font-size:24px;line-height:1.25;">${escapeHtml(heading)}</h1>
            </div>
            <div style="padding:28px;">
              ${bodyHtml}
            </div>
            <div style="border-top:1px solid #eadcc7;background:#fbf7f0;padding:18px 28px;color:#6f6258;font-size:12px;line-height:1.5;">
              ${footerHtml}
            </div>
          </div>
        </div>
      </div>
    `,
    text,
  };
}

function renderBroadcastHtml({ subject, message, recipient, unsubscribeUrl }) {
  const variables = {
    email: recipient.email,
    firstName: recipient.firstName,
    lastName: recipient.lastName,
    unsubscribeUrl,
    supportPhone: '',
    supportEmail: '',
  };
  const heading = renderNewsletterTemplateText(subject, variables);
  const bodyHtml = renderEmailTextBlock(message, variables);
  const footerHtml = renderEmailTextBlock(
    `This message was sent to [subscriber email] because you subscribed to updates from Goodwill Presbyterian Church.\n\nIf you no longer wish to receive updates, unsubscribe here:\n[unsubscribe link]`,
    variables
  );
  const text = [
    renderNewsletterTemplateText(message, variables),
    renderNewsletterTemplateText(`If you no longer wish to receive updates, unsubscribe here:\n[unsubscribe link]`, variables),
  ].filter(Boolean).join('\n\n');

  return {
    subject: heading,
    html: `
      <div style="margin:0;padding:0;background:#f8f3ea;font-family:Arial,Helvetica,sans-serif;color:#2f241c;">
        <div style="max-width:680px;margin:0 auto;padding:32px 18px;">
          <div style="background:#ffffff;border:1px solid #eadcc7;border-radius:12px;overflow:hidden;">
            <div style="background:#4b342a;color:#ffffff;padding:24px 28px;">
              <p style="margin:0 0 8px;color:#f4d78d;font-size:12px;font-weight:bold;letter-spacing:0.08em;text-transform:uppercase;">Goodwill Presbyterian Church</p>
              <h1 style="margin:0;font-size:24px;line-height:1.25;">${escapeHtml(heading)}</h1>
            </div>
            <div style="padding:28px;">
              ${bodyHtml}
            </div>
            <div style="border-top:1px solid #eadcc7;background:#fbf7f0;padding:18px 28px;color:#6f6258;font-size:12px;line-height:1.5;">
              ${footerHtml}
            </div>
          </div>
        </div>
      </div>
    `,
    text,
  };
}

async function sendResendEmail({ from, to, subject, html, text, attachments = [] }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    return {
      ok: false,
      status: 500,
      body: 'RESEND_API_KEY is not configured on the server.',
    };
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to,
      subject,
      html,
      text,
      ...(attachments.length > 0 ? { attachments } : {}),
    }),
  });
  const body = await response.text();

  return {
    ok: response.ok,
    status: response.status,
    body,
  };
}

// Simple filter: exact match on keys in filter object
function applyFilter(items, filter = {}) {
  const keys = Object.keys(filter || {});
  if (keys.length === 0) return items;
  return items.filter(item => keys.every(k => String(item[k]) === String(filter[k])));
}

function applySortAndLimit(items, sort, limit) {
  let result = [...items];
  if (sort) {
    const descending = sort.startsWith('-');
    const key = descending ? sort.slice(1) : sort;
    result.sort((a, b) => {
      const av = a[key] ?? '';
      const bv = b[key] ?? '';
      if (av === bv) return 0;
      return (av > bv ? 1 : -1) * (descending ? -1 : 1);
    });
  }
  return limit ? result.slice(0, Number(limit)) : result;
}

app.post('/api/entities/:entity/filter', (req, res) => {
  const { entity } = req.params;
  const { filter, sort, limit } = req.body;
  const items = readEntity(entity);
  const result = applySortAndLimit(applyFilter(items, filter), sort, limit);
  res.json(result);
});

app.get('/api/entities/:entity', (req, res) => {
  const { entity } = req.params;
  const { sort, limit } = req.query;
  const items = readEntity(entity);
  res.json(applySortAndLimit(items, sort, limit));
});

app.post('/api/entities/:entity', (req, res) => {
  const { entity } = req.params;
  const data = req.body;
  const items = readEntity(entity);

  if (entity === 'NewsletterSubscriptions') {
    const email = normalizeEmail(data.email);
    const emailKey = data.email_key || encodeURIComponent(email);
    const firstName = String(data.first_name || '').trim().replace(/\s+/g, ' ');
    const lastName = String(data.last_name || '').trim().replace(/\s+/g, ' ');
    const existingIndex = items.findIndex(item => item.email_key === emailKey || normalizeEmail(item.email) === email);

    if (existingIndex !== -1 && items[existingIndex].status !== 'unsubscribed') {
      return res.status(409).json({ error: 'already-subscribed' });
    }

    const item = {
      id: emailKey,
      ...data,
      first_name: firstName,
      last_name: lastName,
      email,
      email_key: emailKey,
      status: 'active',
      created_date: data.created_date || new Date().toISOString(),
    };

    if (existingIndex === -1) {
      items.push(item);
    } else {
      items[existingIndex] = { ...items[existingIndex], ...item };
    }

    writeEntity(entity, items);
    return res.status(201).json(item);
  }

  if (entity === 'EmailTemplates') {
    const id = data.id;
    if (!id) return res.status(400).json({ error: 'Email template id is required' });
    const existingIndex = items.findIndex(item => String(item.id) === String(id));
    const item = {
      ...data,
      id,
      created_date: data.created_date || new Date().toISOString(),
    };

    if (existingIndex === -1) {
      items.push(item);
    } else {
      items[existingIndex] = { ...items[existingIndex], ...item };
    }

    writeEntity(entity, items);
    return res.status(201).json(item);
  }

  const id = Date.now().toString();
  const item = { id, ...data };
  items.push(item);
  writeEntity(entity, items);
  res.status(201).json(item);
});

app.delete('/api/entities/:entity/:id', (req, res) => {
  const { entity, id } = req.params;
  let items = readEntity(entity);
  const exists = items.some(i => String(i.id) === String(id));
  if (!exists) return res.status(404).json({ error: 'Not found' });
  items = items.filter(i => String(i.id) !== String(id));
  writeEntity(entity, items);
  res.json({ success: true });
});

app.put('/api/entities/:entity/:id', (req, res) => {
  const { entity, id } = req.params;
  const items = readEntity(entity);
  const index = items.findIndex(i => String(i.id) === String(id));
  if (index === -1) return res.status(404).json({ error: 'Not found' });
  items[index] = { ...items[index], ...req.body, id: items[index].id };
  writeEntity(entity, items);
  res.json(items[index]);
});

async function handleUnsubscribeRequest(req, res) {
  const { email, emailKey, token } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  // remove from NewsletterSubscriptions
  const subs = readEntity('NewsletterSubscriptions');
  const normalizedEmail = normalizeEmail(email);
  const remaining = subs.filter((subscription) => {
    const keyMatches = emailKey && subscription.email_key === emailKey;
    const emailMatches = normalizeEmail(subscription.email) === normalizedEmail;
    const tokenMatches = subscription.unsubscribe_token
      ? Boolean(token) && subscription.unsubscribe_token === token
      : true;

    return !(tokenMatches && (keyMatches || emailMatches));
  });
  writeEntity('NewsletterSubscriptions', remaining);

  // Optionally call Resend suppression
  const key = process.env.RESEND_API_KEY;
  if (key) {
    try {
      await fetch('https://api.resend.com/emails/suppressed', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
    } catch (e) {
      console.warn('Resend suppression failed', e?.message || e);
    }
  }

  res.json({ success: true });
}

// Resend suppression + send welcome email endpoints
app.post('/api/unsubscribe', handleUnsubscribeRequest);

app.post('/api/functions/unsubscribeNewsletter', handleUnsubscribeRequest);

app.post('/api/send-welcome-email', async (req, res) => {
  const { email, emailKey, firstName, lastName, unsubscribeToken, host, protocol } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'Goodwill Presbyterian Church <onboarding@resend.dev>';

  const normalizedEmail = normalizeEmail(email);
  const siteHost = host || 'www.goodwillpres.org';
  const siteProtocol = protocol || 'https';
  const unsubscribeParams = new URLSearchParams({
    email: normalizedEmail,
    key: emailKey || encodeURIComponent(normalizedEmail),
  });

  if (unsubscribeToken) {
    unsubscribeParams.set('token', unsubscribeToken);
  }

  const unsubscribeUrl = `${siteProtocol}://${siteHost}/Unsubscribe?${unsubscribeParams.toString()}`;

  try {
    const emailContent = await buildNewsletterEmail({
      templateId: NEWSLETTER_TEMPLATE_IDS.welcome,
      email: normalizedEmail,
      firstName: String(firstName || '').trim().replace(/\s+/g, ' '),
      lastName: String(lastName || '').trim().replace(/\s+/g, ' '),
      unsubscribeUrl,
    });
    const response = await sendResendEmail({
      from: fromEmail,
      to: normalizedEmail,
      subject: emailContent.subject,
      html: emailContent.html,
      text: emailContent.text,
    });
    if (!response.ok) {
      console.error('Resend welcome email error', response.body);
      return res.status(502).json({
        error: 'Welcome email was not sent.',
        detail: response.body.slice(0, 500),
      });
    }
    const data = JSON.parse(response.body || '{}');
    res.json({ success: true, id: data.id });
  } catch (e) {
    console.error('Send welcome error', e?.message || e);
    res.status(500).json({ error: e?.message || 'Error' });
  }
});

app.post('/api/send-duplicate-subscription-email', async (req, res) => {
  const { email, firstName, lastName } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'Goodwill Presbyterian Church <onboarding@resend.dev>';
  const normalizedEmail = normalizeEmail(email);

  try {
    const emailContent = await buildNewsletterEmail({
      templateId: NEWSLETTER_TEMPLATE_IDS.duplicate,
      email: normalizedEmail,
      firstName: String(firstName || '').trim().replace(/\s+/g, ' '),
      lastName: String(lastName || '').trim().replace(/\s+/g, ' '),
    });
    const response = await sendResendEmail({
      from: fromEmail,
      to: normalizedEmail,
      subject: emailContent.subject,
      html: emailContent.html,
      text: emailContent.text,
    });
    if (!response.ok) {
      console.error('Resend duplicate subscription error', response.body);
      return res.status(502).json({
        error: 'Duplicate subscription email was not sent.',
        detail: response.body.slice(0, 500),
      });
    }
    const data = JSON.parse(response.body || '{}');
    res.json({ success: true, id: data.id });
  } catch (e) {
    console.error('Send duplicate subscription error', e?.message || e);
    res.status(500).json({ error: e?.message || 'Error' });
  }
});

app.post('/api/send-newsletter-broadcast', async (req, res) => {
  try {
    await assertAdminRequest(req);
  } catch (error) {
    return res.status(error.status || 401).json({ error: error.message });
  }

  const { subject, message, recipients = [], attachments = [], host, protocol } = req.body || {};
  const normalizedSubject = String(subject || '').trim();
  const normalizedMessage = String(message || '').trim();
  const activeRecipients = recipients
    .map((recipient) => ({
      email: normalizeEmail(recipient.email),
      firstName: normalizePersonName(recipient.firstName || recipient.first_name),
      lastName: normalizePersonName(recipient.lastName || recipient.last_name),
      emailKey: recipient.emailKey || recipient.email_key,
      unsubscribeToken: recipient.unsubscribeToken || recipient.unsubscribe_token,
    }))
    .filter((recipient) => recipient.email);
  const preparedAttachments = (await Promise.all(attachments.map(async (attachment) => {
    const filename = String(attachment.filename || '').trim();
    const contentType = String(attachment.contentType || attachment.content_type || '').trim() || undefined;
    const inlineContent = String(attachment.content || '').trim();
    const fileUrl = String(attachment.file_url || attachment.fileUrl || '').trim();

    if (filename && inlineContent) {
      return { filename, content_type: contentType, content: inlineContent };
    }

    if (filename && fileUrl) {
      const fileResponse = await fetch(fileUrl);
      if (!fileResponse.ok) return null;
      const fileBuffer = Buffer.from(await fileResponse.arrayBuffer());
      return {
        filename,
        content_type: contentType || fileResponse.headers.get('content-type') || undefined,
        content: fileBuffer.toString('base64'),
      };
    }

    return null;
  }))).filter(Boolean);

  if (!normalizedSubject) return res.status(400).json({ error: 'Subject is required.' });
  if (!normalizedMessage) return res.status(400).json({ error: 'Message is required.' });
  if (activeRecipients.length === 0) return res.status(400).json({ error: 'At least one active subscriber is required.' });
  if (activeRecipients.length > 500) return res.status(400).json({ error: 'Please send to 500 or fewer recipients at a time.' });
  if (preparedAttachments.length > 5) return res.status(400).json({ error: 'Please attach no more than 5 files.' });

  const totalAttachmentBytes = preparedAttachments.reduce((sum, attachment) => {
    return sum + Math.ceil((attachment.content.length * 3) / 4);
  }, 0);

  if (totalAttachmentBytes > 8 * 1024 * 1024) {
    return res.status(400).json({ error: 'Attachments must be 8 MB or less combined.' });
  }

  const fromEmail = process.env.RESEND_FROM_EMAIL || 'Goodwill Presbyterian Church <onboarding@resend.dev>';
  const siteHost = host || 'www.goodwillpres.org';
  const siteProtocol = protocol || 'https';
  const results = [];

  for (const recipient of activeRecipients) {
    const unsubscribeParams = new URLSearchParams({
      email: recipient.email,
      key: recipient.emailKey || encodeURIComponent(recipient.email),
    });

    if (recipient.unsubscribeToken) {
      unsubscribeParams.set('token', recipient.unsubscribeToken);
    }

    const unsubscribeUrl = `${siteProtocol}://${siteHost}/Unsubscribe?${unsubscribeParams.toString()}`;
    const emailContent = renderBroadcastHtml({
      subject: normalizedSubject,
      message: normalizedMessage,
      recipient,
      unsubscribeUrl,
    });

    const response = await sendResendEmail({
      from: fromEmail,
      to: recipient.email,
      subject: emailContent.subject,
      html: emailContent.html,
      text: emailContent.text,
      attachments: preparedAttachments,
    });

    if (!response.ok) {
      results.push({
        email: recipient.email,
        success: false,
        detail: response.body.slice(0, 300),
      });
    } else {
      let id = '';
      try {
        id = JSON.parse(response.body || '{}').id || '';
      } catch {
        id = '';
      }
      results.push({ email: recipient.email, success: true, id });
    }
  }

  const sent = results.filter((result) => result.success).length;
  const failed = results.length - sent;
  res.json({ success: failed === 0, sent, failed, results });
});

const useLocalViteServer = process.env.LOCAL_VITE_DEV === 'true';

if (useLocalViteServer) {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    appType: 'custom',
    server: { middlewareMode: true },
  });

  app.use(vite.middlewares);
  app.use(async (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      return next();
    }

    try {
      const template = fs.readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf8');
      const html = await vite.transformIndexHtml(req.originalUrl, template);
      res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
    } catch (error) {
      vite.ssrFixStacktrace(error);
      next(error);
    }
  });
} else if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));

  app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'API route not found' });
    }

    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
}

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`Node site listening on port ${port}`));
