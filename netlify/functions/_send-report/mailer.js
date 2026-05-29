/**
 * Provider-agnostic transactional email helper for the
 * "send incident report to customer" flow.
 *
 * Configured by environment variables (set in Netlify → Site settings → Env):
 *
 *   MAIL_PROVIDER    one of: "resend", "sendgrid", "log"  (default: "log")
 *   MAIL_FROM        the from-address (display name allowed)
 *   MAIL_REPLY_TO    optional reply-to address
 *
 * Provider-specific secrets:
 *   RESEND_API_KEY     when MAIL_PROVIDER = "resend"
 *   SENDGRID_API_KEY   when MAIL_PROVIDER = "sendgrid"
 *
 * Provider "log" never sends anything; it simply records that the call
 * happened. Useful for local development and for environments that don't
 * yet have outbound email configured.
 */

const RESEND_API   = 'https://api.resend.com/emails';
const SENDGRID_API = 'https://api.sendgrid.com/v3/mail/send';

export async function sendIncidentEmail({
  to,
  subject,
  body,
  pdfBase64,
  pdfFilename,
  env,
}) {
  if (!to || !to.length) throw new Error('No recipient addresses provided');

  const provider = (env.MAIL_PROVIDER || 'log').toLowerCase();
  const from     = env.MAIL_FROM || 'XConnect Field Service <no-reply@xconnect.local>';
  const replyTo  = env.MAIL_REPLY_TO || undefined;

  const recipients = Array.isArray(to) ? to : String(to).split(/[,;\s]+/).filter(Boolean);

  if (provider === 'log') {
    // eslint-disable-next-line no-console
    console.log('[send-report] MAIL_PROVIDER=log — would have sent:', {
      to: recipients,
      subject,
      from,
      pdfFilename,
      pdfBytes: pdfBase64 ? Math.floor((pdfBase64.length * 3) / 4) : 0,
    });
    return { provider, simulated: true };
  }

  if (provider === 'resend') {
    const key = env.RESEND_API_KEY;
    if (!key) throw new Error('RESEND_API_KEY is not set');
    const resp = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: recipients,
        reply_to: replyTo,
        subject,
        text: body,
        attachments: pdfBase64
          ? [{ filename: pdfFilename || 'incident-report.pdf', content: pdfBase64 }]
          : [],
      }),
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      throw new Error(`Resend send failed (${resp.status}): ${txt.slice(0, 500)}`);
    }
    const data = await resp.json().catch(() => ({}));
    return { provider, id: data.id || null };
  }

  if (provider === 'sendgrid') {
    const key = env.SENDGRID_API_KEY;
    if (!key) throw new Error('SENDGRID_API_KEY is not set');
    const resp = await fetch(SENDGRID_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [
          { to: recipients.map((email) => ({ email })) },
        ],
        from: parseFromAddress(from),
        reply_to: replyTo ? parseFromAddress(replyTo) : undefined,
        subject,
        content: [{ type: 'text/plain', value: body }],
        attachments: pdfBase64
          ? [
              {
                content: pdfBase64,
                filename: pdfFilename || 'incident-report.pdf',
                type: 'application/pdf',
                disposition: 'attachment',
              },
            ]
          : undefined,
      }),
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      throw new Error(`SendGrid send failed (${resp.status}): ${txt.slice(0, 500)}`);
    }
    return { provider, id: resp.headers.get('x-message-id') || null };
  }

  throw new Error(`Unknown MAIL_PROVIDER: ${provider}`);
}

function parseFromAddress(addr) {
  const m = addr.match(/^\s*(.+?)\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1], email: m[2] };
  return { email: addr };
}
