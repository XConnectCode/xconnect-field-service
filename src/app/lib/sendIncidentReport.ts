/**
 * Client-side helper that posts a generated incident PDF to the
 * /api/send-incident-report Netlify function. Keeps the React layer
 * free of mailer/provider details.
 */

import { supabase } from './supabase';

export interface SendIncidentReportPayload {
  incidentRowId: string;
  eventId: string;
  recipients: string;
  subject?: string;
  message?: string;
  pdfBlob: Blob;
  pdfFilename?: string;
  senderName?: string | null;
  senderEmail?: string | null;
}

export interface SendIncidentReportResult {
  ok: true;
  sentAt: string;
  provider: string;
  simulated: boolean;
  auditError: string | null;
}

const ENDPOINT = '/api/send-incident-report';

async function blobToBase64(blob: Blob): Promise<string> {
  const dataUrl: string = await new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onloadend = () => res(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => rej(new Error('Failed to read PDF blob'));
    reader.readAsDataURL(blob);
  });
  const commaIdx = dataUrl.indexOf(',');
  return commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
}

export async function sendIncidentReportToCustomer(
  payload: SendIncidentReportPayload,
): Promise<SendIncidentReportResult> {
  const pdfBase64 = await blobToBase64(payload.pdfBlob);

  const resp = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      incidentRowId: payload.incidentRowId,
      eventId: payload.eventId,
      recipients: payload.recipients,
      subject: payload.subject,
      message: payload.message,
      pdfBase64,
      pdfFilename:
        payload.pdfFilename || `Incident_${payload.eventId || 'XC'}_Report.pdf`,
      senderName: payload.senderName ?? null,
      senderEmail: payload.senderEmail ?? null,
    }),
  });

  let data: any = {};
  try { data = await resp.json(); } catch { /* ignore */ }

  if (!resp.ok) {
    throw new Error(data?.error || `Send failed (${resp.status})`);
  }

  // Audit-trail belt-and-braces: if the Netlify function couldn't write the
  // audit columns (no service-role key configured, etc.), still update what
  // we can from the client. This way the UI always reflects the send.
  if (data?.auditError) {
    await supabase
      .from('incidents')
      .update({
        report_sent: data.sentAt || new Date().toISOString(),
        report_sent_to: payload.recipients,
        report_sent_by: payload.senderEmail || payload.senderName || null,
        report_sent_message: payload.message || null,
      })
      .eq('row_id', payload.incidentRowId)
      .then(() => undefined, () => undefined);
  }

  return data as SendIncidentReportResult;
}
