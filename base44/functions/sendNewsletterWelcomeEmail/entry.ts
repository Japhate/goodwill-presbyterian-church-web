const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const SENDER_EMAIL = 'onboarding@resend.dev';

Deno.serve(async (req) => {
  try {
    const { data } = await req.json();
    const subscriberEmail = data?.email;

    if (!subscriberEmail) {
      return Response.json({ error: 'Email is required' }, { status: 400 });
    }

    if (!RESEND_API_KEY) {
      return Response.json({ error: 'RESEND_API_KEY not configured' }, { status: 500 });
    }

    // Build unsubscribe URL - gets the host from request headers for accurate production URL
    const host = req.headers.get('host') || 'goodwillpresbyterianchurch.com';
    const protocol = req.headers.get('x-forwarded-proto') || 'https';
    const unsubscribeUrl = `${protocol}://${host}/Unsubscribe?email=${encodeURIComponent(subscriberEmail)}`;

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: SENDER_EMAIL,
        to: subscriberEmail,
        subject: 'Goodwill Presbyterian Church, USA – Welcome',
        html: `
          <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
            <p>Welcome in the name of our Lord Jesus Christ!</p>
            <p>Thank you for subscribing to the Goodwill Presbyterian Church, USA newsletter. We are truly blessed to have you as part of our family.</p>
            <p>Through this space, you will receive updates on our services, upcoming events, and resources to support your spiritual growth.</p>
            <p>We warmly invite you to worship with us every Sunday at 10:30 AM at:<br/>
            295 N Brick Church Road, Mayesville, SC 29104</p>
            <p>If you have any questions or would like to connect, feel free to reach out:<br/>
            📧 <a href="mailto:goodwillpresch1867@gmail.com">goodwillpresch1867@gmail.com</a> or 📞 <a href="tel:8034953599">(803) 495-3599</a></p>
            <p>May God's peace, love, and grace continue to guide you.</p>
            <p>In Christ,<br/>
            Goodwill Presbyterian Church, USA</p>
            <hr style="margin-top: 30px; border: none; border-top: 1px solid #ddd;" />
            <p style="font-size: 12px; color: #999; margin-top: 20px;">
              <a href="${unsubscribeUrl}" style="color: #999; text-decoration: underline;">Unsubscribe from this newsletter</a>
            </p>
          </div>
        `,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('Resend API error:', error);
      return Response.json({ error: 'Failed to send email' }, { status: 500 });
    }

    const result = await response.json();
    console.log('Welcome email sent:', result.id);
    return Response.json({ success: true, emailId: result.id });
  } catch (error) {
    console.error('Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});