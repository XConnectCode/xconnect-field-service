/**
 * Combined Field Visit + Training Checklist customer report.
 *
 * Produces a single printable PDF an SQM can hand to / email a customer after a
 * training visit. Three sections:
 *   1. Visit details  — purpose, dates, XC rep, customer / district / operating
 *      company, field-or-facility, pad/well, equipment.
 *   2. Training checklist — template name, product line, each step with ✓ / ✗.
 *   3. Notes & sign-off — session notes, SQM (trainer) + training date, signoff.
 *
 * NO incidents (per product decision). Customer / district row_ids are resolved
 * to display names with a fallback to the raw stored value so legacy free-text
 * names still render.
 *
 * Reuses the shared PDF infra in ./pdfUtils (CDN jsPDF, A4 portrait mm).
 */
import {
  loadJsPDF, drawHeader, drawFooters, drawSectionHeading,
  XC_GREEN, XC_DARK, XC_BORDER, GRAY_TEXT,
  MARGIN, CONT_W, PAGE_H,
} from './pdfUtils';
import { resolveSessionNames, type ChecklistSession } from './trainingChecklists';

export interface TrainingVisitReportOptions {
  /** Full field visit record (fieldvisits row) — optional for standalone checklist. */
  visit?: Record<string, any> | null;
  /** The training checklist session. */
  session: ChecklistSession;
  /**
   * Optional pre-resolved customer/district names. When omitted we resolve the
   * session's stored customer / customer_district row_ids ourselves.
   */
  customerName?: string | null;
  districtName?: string | null;
  returnBlob?: boolean;
}

/**
 * Format a date for display. Handles both date-only strings ('2026-06-05') and
 * full ISO timestamps ('2026-06-05T12:22:00+00:00'); only the date-only form is
 * anchored to noon to avoid TZ rollover.
 */
function fmtDate(val?: string | null): string {
  if (!val) return '—';
  try {
    const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(val);
    const d = new Date(isDateOnly ? val + 'T12:00:00' : val);
    return isNaN(d.getTime()) ? val : d.toLocaleDateString();
  } catch { return val; }
}

function fmtDateTime(val?: string | null): string {
  if (!val) return '—';
  try {
    const d = new Date(val);
    return isNaN(d.getTime()) ? val : d.toLocaleDateString();
  } catch { return val; }
}

/**
 * Format the visit duration for display. Prefers the stored `visit_duration`
 * (an "H:MM:SS" wall-clock string, e.g. "1:30:00") and renders it as a friendly
 * "1h 30m". If that column is empty, falls back to computing the delta between
 * arrival and departure. Both timestamps share the same offset so the delta is
 * timezone-invariant (treated as naive wall-clock per the app-wide rule).
 */
function fmtDuration(
  stored?: string | null,
  arrival?: string | null,
  departure?: string | null,
): string | null {
  // 1. Parse the stored "H:MM:SS" string.
  if (stored && /^\d+:\d{1,2}(:\d{1,2})?$/.test(stored.trim())) {
    const parts = stored.trim().split(':').map((p) => parseInt(p, 10));
    const h = parts[0] || 0;
    const m = parts[1] || 0;
    return formatHM(h, m);
  }
  // 2. Fall back to arrival → departure delta.
  if (arrival && departure) {
    try {
      const ms = new Date(departure).getTime() - new Date(arrival).getTime();
      if (isFinite(ms) && ms > 0) {
        const totalMin = Math.round(ms / 60000);
        return formatHM(Math.floor(totalMin / 60), totalMin % 60);
      }
    } catch { /* ignore */ }
  }
  return null;
}

function formatHM(h: number, m: number): string {
  if (h <= 0 && m <= 0) return '0m';
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  return parts.join(' ');
}

/** Detect a jsPDF image format string from a mime / URL. */
function pickSigFormat(mime: string | null, url: string): string {
  const m = (mime || '').toLowerCase();
  if (m.includes('jpeg') || m.includes('jpg')) return 'JPEG';
  if (m.includes('webp')) return 'WEBP';
  const path = url.split('?')[0].toLowerCase();
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'JPEG';
  if (path.endsWith('.webp')) return 'WEBP';
  return 'PNG'; // SignaturePad uploads PNG
}

/** Fetch an image URL as a data URL so jsPDF can embed it without CORS dances. */
async function fetchSigDataUrl(url: string): Promise<{ dataUrl: string; mime: string } | null> {
  try {
    const resp = await fetch(url, { cache: 'no-store' });
    if (!resp.ok) return null;
    const blob = await resp.blob();
    const mime = blob.type || resp.headers.get('content-type') || '';
    const dataUrl = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onloadend = () => res(typeof r.result === 'string' ? r.result : '');
      r.onerror = () => rej(new Error('reader failed'));
      r.readAsDataURL(blob);
    });
    return { dataUrl, mime };
  } catch { return null; }
}

/**
 * Resolve the signoff signature URL: prefer the persisted column, otherwise look
 * it up from the polymorphic images table (newest signoff_signature for this
 * session). Mirrors the rehydration the session page does on load.
 */
async function resolveSignatureUrl(session: ChecklistSession): Promise<string | null> {
  if (session.signoff_sig_url) return session.signoff_sig_url;
  try {
    const { projectId, publicAnonKey } = await import('/utils/supabase/info');
    const baseUrl = `https://${projectId}.supabase.co/functions/v1/make-server-64775d98`;
    const resp = await fetch(
      `${baseUrl}/images/training_checklist_sessions/${encodeURIComponent(session.id)}`,
      { headers: { Authorization: `Bearer ${publicAnonKey}` } },
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    const files = Array.isArray(data.files) ? data.files : [];
    const sig = files
      .filter((f: any) => f.fieldName === 'signoff_signature' && f.url)
      .sort((a: any, b: any) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
    return sig?.url || null;
  } catch { return null; }
}

export async function generateTrainingVisitReportPDF(
  opts: TrainingVisitReportOptions,
): Promise<Blob | void> {
  const { visit, session, returnBlob = false } = opts;

  // Resolve customer / district names if not supplied. Prefer the session's own
  // customer/district (set via the new dropdown); fall back to the visit's.
  let customerName = opts.customerName ?? null;
  let districtName = opts.districtName ?? null;
  if (customerName == null && districtName == null) {
    const resolved = await resolveSessionNames(
      session.customer ?? (visit?.customer ?? null),
      session.customer_district ?? (visit?.customer_district ?? null),
    );
    customerName = resolved.customerName;
    districtName = resolved.districtName;
  }

  // Resolve + pre-fetch the drawn signature so we can embed it later. Done up
  // front (await) since the render pass below is synchronous.
  let sigDataUrl: string | null = null;
  let sigFmt = 'PNG';
  let sigDims: { w: number; h: number } | null = null;
  try {
    const sigUrl = await resolveSignatureUrl(session);
    if (sigUrl) {
      const fetched = await fetchSigDataUrl(sigUrl);
      if (fetched?.dataUrl) {
        sigDataUrl = fetched.dataUrl;
        sigFmt = pickSigFormat(fetched.mime, sigUrl);
        // Read intrinsic pixel dimensions to preserve aspect ratio in the box.
        sigDims = await new Promise<{ w: number; h: number } | null>((res) => {
          try {
            const img = new Image();
            img.onload = () => res({ w: img.width, h: img.height });
            img.onerror = () => res(null);
            img.src = fetched.dataUrl;
          } catch { res(null); }
        });
      }
    }
  } catch { /* signature is best-effort — never block the report */ }

  const doc = await loadJsPDF();
  const colW = CONT_W / 2;
  let y = drawHeader(doc, 'Training Visit Report') + 10;

  const checkPage = (needed: number) => {
    if (y + needed > PAGE_H - 20) {
      doc.addPage();
      y = drawHeader(doc, 'Training Visit Report') + 10;
    }
  };

  // ── Two-column grid helper (skips empty values) ──
  const twoColGrid = (fields: { label: string; value?: string | null }[]) => {
    const visible = fields.filter(f => f.value && f.value !== '—');
    if (!visible.length) return;
    let col = 0;
    visible.forEach((item) => {
      if (col === 0) checkPage(10);
      const x = MARGIN + (col === 0 ? 0 : colW);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...XC_DARK);
      doc.text(`${item.label}:`, x, y);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(60, 60, 60);
      const labelW = doc.getTextWidth(`${item.label}: `);
      const maxW   = colW - labelW - 4;
      const txt    = doc.splitTextToSize(item.value || '—', maxW)[0];
      doc.text(txt, x + labelW + 1, y);
      col++;
      if (col === 2) { col = 0; y += 8; }
    });
    if (col !== 0) y += 8; // finish odd row
    y += 4;
  };

  // ── Narrative block helper ──
  const narrativeBlock = (title: string, content?: string | null) => {
    if (!content) return;
    checkPage(40);
    if (title) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...XC_GREEN);
      doc.text(title, MARGIN, y);
      y += 5;
    }
    const lines = doc.splitTextToSize(content, CONT_W - 10);
    const boxH  = (lines.length * 6) + 8;
    checkPage(boxH + 6);
    doc.setFillColor(250, 250, 250); doc.setDrawColor(...XC_BORDER); doc.setLineWidth(0.3);
    doc.roundedRect(MARGIN, y, CONT_W, boxH, 1, 1, 'FD');
    doc.setFillColor(...XC_GREEN); doc.rect(MARGIN, y, 1.5, boxH, 'F');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(40, 40, 40);
    lines.forEach((line: string, i: number) => doc.text(line, MARGIN + 6, y + 6.5 + (i * 6)));
    y += boxH + 10;
  };

  // ══════════════════════════════════════════════════════════════════════════════
  // Title row
  // ══════════════════════════════════════════════════════════════════════════════
  doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(...XC_DARK);
  doc.text('Training Visit Report', MARGIN, y);
  y += 7;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...GRAY_TEXT);
  const subtitle = [
    session.field_visit_id ? `Field Visit #${session.field_visit_id}` : null,
    session.template_name  ? session.template_name                    : null,
    session.status         ? `Status: ${session.status === 'completed' ? 'Completed' : 'In Progress'}` : null,
  ].filter(Boolean).join('   |   ');
  if (subtitle) { doc.text(subtitle, MARGIN, y); y += 14; } else { y += 6; }

  // ══════════════════════════════════════════════════════════════════════════════
  // 1. Visit Details
  // ══════════════════════════════════════════════════════════════════════════════
  y = drawSectionHeading(doc, 'Visit Details', y);
  const v = visit || {};
  twoColGrid([
    { label: 'Customer',          value: customerName },
    { label: 'District',          value: districtName },
    { label: 'Operating Company', value: v.operating_company },
    { label: 'Visit Purpose',     value: v.visit_purpose },
    { label: 'Field / Facility',  value: v.field_or_facility },
    { label: 'Pad / Well',        value: v.pad_name || session.location },
    { label: 'XC Representative', value: v.customer_rep || session.trainer_name },
    { label: 'Arrival Date',      value: fmtDate(v.arrival_date) },
    { label: 'Departure Date',    value: fmtDate(v.departure_date) },
    { label: 'Visit Duration',    value: fmtDuration(v.visit_duration, v.arrival_date, v.departure_date) },
    { label: 'Field Visit ID',    value: session.field_visit_id },
  ]);

  // ══════════════════════════════════════════════════════════════════════════════
  // 2. Training Checklist
  // ══════════════════════════════════════════════════════════════════════════════
  checkPage(30);
  y = drawSectionHeading(doc, 'Training Checklist', y);
  twoColGrid([
    { label: 'Template',      value: session.template_name },
    { label: 'Product Line',  value: session.product_line },
    { label: 'Training Date', value: fmtDate(session.training_date) },
    { label: 'Location',      value: session.location },
  ]);

  const steps = Array.isArray(session.step_results) ? session.step_results : [];
  if (steps.length) {
    const doneCount = steps.filter(s => s.done).length;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...GRAY_TEXT);
    doc.text(`${doneCount} of ${steps.length} steps completed`, MARGIN, y);
    y += 7;

    steps.forEach((step) => {
      checkPage(12);
      // status mark
      const mark = step.done ? '[x]' : '[  ]';
      if (step.done) doc.setTextColor(...XC_GREEN); else doc.setTextColor(180, 60, 60);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
      doc.text(mark, MARGIN, y);
      // step text (wrapped)
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(40, 40, 40);
      const lines = doc.splitTextToSize(step.text || '—', CONT_W - 14);
      lines.forEach((line: string, i: number) => {
        if (i > 0) checkPage(6);
        doc.text(line, MARGIN + 10, y);
        if (i < lines.length - 1) y += 5.5;
      });
      y += 8;
    });
    y += 2;
  } else {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.setTextColor(...GRAY_TEXT);
    doc.text('No checklist steps recorded.', MARGIN, y);
    y += 10;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 3. Notes & Sign-off
  // ══════════════════════════════════════════════════════════════════════════════
  checkPage(30);
  y = drawSectionHeading(doc, 'Notes & Sign-off', y);
  narrativeBlock('', session.notes);

  twoColGrid([
    { label: 'Trainer (SQM)', value: session.trainer_name },
    { label: 'Training Date', value: fmtDate(session.training_date) },
    { label: 'Customer / Trainee Sign-off', value: session.signoff_name },
    { label: 'Completed',     value: session.completed_at ? fmtDateTime(session.completed_at) : null },
  ]);

  // ── Drawn signature image ──
  if (sigDataUrl) {
    const sigBoxW = 70;   // mm
    const sigBoxH = 28;   // mm
    checkPage(sigBoxH + 14);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...XC_DARK);
    doc.text('Signature:', MARGIN, y);
    y += 4;
    // Framed box that the signature sits inside (scaled to fit, aspect-preserved).
    doc.setDrawColor(...XC_BORDER); doc.setLineWidth(0.3);
    doc.roundedRect(MARGIN, y, sigBoxW, sigBoxH, 1, 1, 'S');
    try {
      const pad = 2;
      let drawW = sigBoxW - pad * 2;
      let drawH = sigBoxH - pad * 2;
      if (sigDims && sigDims.w > 0 && sigDims.h > 0) {
        const ratio = sigDims.h / sigDims.w;
        drawH = drawW * ratio;
        if (drawH > sigBoxH - pad * 2) {
          drawH = sigBoxH - pad * 2;
          drawW = drawH / ratio;
        }
      }
      const ix = MARGIN + (sigBoxW - drawW) / 2;
      const iy = y + (sigBoxH - drawH) / 2;
      doc.addImage(sigDataUrl, sigFmt, ix, iy, drawW, drawH);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('Signature embed failed:', err);
    }
    y += sigBoxH + 4;
    if (session.signoff_name) {
      doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(...GRAY_TEXT);
      doc.text(`Signed: ${session.signoff_name}`, MARGIN, y);
      y += 6;
    }
  }

  drawFooters(doc);

  if (returnBlob) return doc.output('blob') as Blob;
  const idPart = session.field_visit_id || session.id.slice(0, 8);
  doc.save(`TrainingVisit_${idPart}.pdf`);
}
