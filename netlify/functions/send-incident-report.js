/**
 * Netlify function: POST /send-incident-report
 *
 * Wraps the mailer and the Supabase audit-trail update so the browser only
 * has to forward the (already-generated) PDF blob and a few metadata fields.
 *
 * Expected JSON body:
 *   {
 *     incidentRowId: string;
 *     eventId: string;
 *     recipients: string | string[];   // comma-separated allowed
 *     subject?: string;
 *     message?: string;                 // cover note
 *     pdfBase64: string;                // PDF bytes, base64-encoded
 *     pdfFilename?: string;
 *     senderName?: string;              // from the authenticated user
 *     senderEmail?: string;
 *   }
 *
 * Returns:
 *   { ok: true, sentAt: ISOString, provider: string, simulated?: boolean }
 *
 * Errors are surfaced with a JSON body { error: string } and a non-2xx code.
 *
 * Requires environment configuration:
 *   - MAIL_PROVIDER, MAIL_FROM, plus provider key (see _send-report/mailer.js)
 *   - SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for the audit-trail update
 */

import { sendIncidentEmail } from './_send-report/mailer.js';

const ALLOWED_METHODS = new Set(['POST', 'OPTIONS']);
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export const handler = async (req) => {
  if (req.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }
  if (!ALLOWED_METHODS.has(req.httpMethod)) {
    return resp(405, { error: 'Method Not Allowed' });
  }

  let body;
  try {
    body = JSON.parse(req.body || '{}');
  } catch {
    return resp(400, { error: 'Invalid JSON body' });
  }

  const {
    incidentRowId,
    eventId,
    recipients,
    subject,
    message,
    pdfBase64,
    pdfFilename,
    senderName,
    senderEmail,
  } = body;

  if (!incidentRowId) return resp(400, { error: 'incidentRowId is required' });
  if (!recipients)    return resp(400, { error: 'recipients is required' });
  if (!pdfBase64)     return resp(400, { error: 'pdfBase64 is required' });

  const recipientList = normalizeRecipients(recipients);
  if (recipientList.length === 0) {
    return resp(400, { error: 'No valid recipient email addresses' });
  }

  const env = process.env;
  const finalSubject = subject || `XConnect Incident Report${eventId ? ` #${eventId}` : ''}`;
  const finalMessage = composeBody({ message, eventId, senderName });

  let sendResult;
  try {
    sendResult = await sendIncidentEmail({
      to: recipientList,
      subject: finalSubject,
      body: finalMessage,
      pdfBase64,
      pdfFilename,
      env,
    });
  } catch (err) {
    return resp(502, { error: `Send failed: ${err.message || err}` });
  }

  const sentAt = new Date().toISOString();

  // Audit trail — best-effort. We still report success to the user even
  // when the audit update fails, because the email has already gone out.
  const auditErr = await writeAuditTrail({
    incidentRowId,
    sentAt,
    recipients: recipientList,
    senderEmail,
    senderName,
    message,
    env,
  });

  return resp(200, {
    ok: true,
    sentAt,
    provider: sendResult.provider,
    simulated: !!sendResult.simulated,
    auditError: auditErr || null,
  });
};

function normalizeRecipients(input) {
  if (Array.isArray(input)) {
    return input.map((s) => String(s).trim()).filter(isLikelyEmail);
  }
  return String(input)
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(isLikelyEmail);
}

function isLikelyEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function composeBody({ message, eventId, senderName }) {
  const greeting = 'Hello,';
  const intro = eventId
    ? `Attached is the incident report for Event #${eventId}.`
    : 'Attached is the incident report you requested.';
  const note = message && message.trim() ? `\n\n${message.trim()}` : '';
  const signoff = senderName
    ? `\n\nRegards,\n${senderName}\nXConnect Field Service`
    : '\n\nRegards,\nXConnect Field Service';
  return `${greeting}\n\n${intro}${note}${signoff}\n`;
}

async function writeAuditTrail({
  incidentRowId,
  sentAt,
  recipients,
  senderEmail,
  senderName,
  message,
  env,
}) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — audit trail skipped';
  }

  try {
    const patchUrl = `${url}/rest/v1/incidents?row_id=eq.${encodeURIComponent(incidentRowId)}`;
    const resp = await fetch(patchUrl, {
      method: 'PATCH',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        report_sent: sentAt,
        report_sent_to: recipients.join(', '),
        report_sent_by: senderEmail || senderName || null,
        report_sent_message: message || null,
      }),
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      return `incidents PATCH failed (${resp.status}): ${txt.slice(0, 300)}`;
    }
    return null;
  } catch (err) {
    return `audit error: ${err.message || err}`;
  }
}

function resp(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    body: JSON.stringify(body),
  };
}
