import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');

Deno.serve(async (req) => {
  try {
    const { email } = await req.json();

    if (!email) {
      return Response.json({ error: 'Email is required' }, { status: 400 });
    }

    const base44 = createClientFromRequest(req);
    
    // Use service role to delete subscriptions by email
    const subscriptions = await base44.asServiceRole.entities.NewsletterSubscriptions.filter({ email });
    
    if (subscriptions.length === 0) {
      return Response.json({ success: true, message: 'Email was not subscribed' });
    }

    for (const subscription of subscriptions) {
      await base44.asServiceRole.entities.NewsletterSubscriptions.delete(subscription.id);
    }

    // Add email to Resend suppression list
    if (RESEND_API_KEY) {
      try {
        await fetch('https://api.resend.com/emails/suppressed', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ email }),
        });
      } catch (resendError) {
        console.warn('Failed to suppress email in Resend:', resendError.message);
        // Don't fail the unsubscribe if Resend suppression fails
      }
    }

    return Response.json({ success: true, message: 'Unsubscribed successfully' });
  } catch (error) {
    console.error('Unsubscribe error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});