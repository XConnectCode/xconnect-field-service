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
    { label: 'Customer Sign-off', value: session.signoff_name },
    { label: 'Completed',     value: session.completed_at ? fmtDateTime(session.completed_at) : null },
  ]);

  drawFooters(doc);

  if (returnBlob) return doc.output('blob') as Blob;
  const idPart = session.field_visit_id || session.id.slice(0, 8);
  doc.save(`TrainingVisit_${idPart}.pdf`);
}
