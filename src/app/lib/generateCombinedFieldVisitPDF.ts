/**
 * Combined Field Visit PDF.
 *
 * One printable PDF for a field visit with four parts:
 *   1. Visit details   — purpose, dates, XC rep, customer / district / pad, equipment.
 *   2. Training checklist(s) — every session linked to the visit, each step with ✓ / ✗.
 *   3. Hardware inspection — inspector, overall status, each component with its
 *      flagged wear checks, condition and note.
 *   4. Embedded component photos — pulled from the polymorphic images table and
 *      laid out beneath each component item.
 *
 * Modeled on generateTrainingVisitReportPDF.ts and reuses the shared infra in
 * ./pdfUtils. arrival_date / departure_date are treated as naive wall-clock
 * (no timezone conversion), per the app-wide rule.
 */
import {
  loadJsPDF, drawHeader, drawFooters, drawSectionHeading,
  XC_GREEN, XC_DARK, XC_BORDER, GRAY_TEXT,
  MARGIN, CONT_W, PAGE_H,
} from './pdfUtils';
import {
  listSessionsForVisit, resolveSessionNames, type ChecklistSession,
} from './trainingChecklists';
import { hardwareInspectionApi } from './api';

export interface CombinedFieldVisitPDFOptions {
  /** Full field visit record (fieldvisits row). */
  visit: Record<string, any> | null | undefined;
  /** Pre-resolved customer / district display names (from the detail page). */
  customerName?: string | null;
  districtName?: string | null;
  /** Signed-in user's access token, forwarded to the edge API. */
  accessToken?: string | null;
  returnBlob?: boolean;
}

// ── Hardware inspection labels (mirror HardwareInspection.tsx) ──────────────────
const STATUS_LABEL: Record<string, string> = {
  pass: 'Pass',
  monitor: 'Monitor',
  replace_soon: 'Replace soon',
  remove: 'Remove from service',
};

const CHECK_LABELS: { key: string; label: string }[] = [
  { key: 'chk_threads', label: 'Threads' },
  { key: 'chk_pitting', label: 'Pitting' },
  { key: 'chk_corrosion', label: 'Corrosion' },
  { key: 'chk_sealing_surfaces', label: 'Sealing surfaces' },
  { key: 'chk_makeup_feel', label: 'Make-up feel' },
  { key: 'chk_makeup_cleanliness', label: 'Make-up cleanliness' },
  { key: 'chk_bore_retainer', label: 'Bore/Retainer' },
  { key: 'chk_general_damage', label: 'General damage' },
];

/**
 * Format a date for display. Handles both date-only strings ('2026-06-05') and
 * full ISO timestamps; the date-only form is anchored to noon to avoid TZ
 * rollover. Naive wall-clock — no offset conversion.
 */
function fmtDate(val?: string | null): string {
  if (!val) return '—';
  try {
    const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(val);
    const d = new Date(isDateOnly ? val + 'T12:00:00' : val);
    return isNaN(d.getTime()) ? val : d.toLocaleDateString();
  } catch { return val; }
}

function fmtDuration(
  stored?: string | null,
  arrival?: string | null,
  departure?: string | null,
): string | null {
  if (stored && /^\d+:\d{1,2}(:\d{1,2})?$/.test(stored.trim())) {
    const parts = stored.trim().split(':').map((p) => parseInt(p, 10));
    return formatHM(parts[0] || 0, parts[1] || 0);
  }
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
  return 'PNG';
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

/** Read intrinsic pixel dimensions of a data URL (best-effort). */
function readImageDims(dataUrl: string): Promise<{ w: number; h: number } | null> {
  return new Promise((res) => {
    try {
      const img = new Image();
      img.onload = () => res({ w: img.width, h: img.height });
      img.onerror = () => res(null);
      img.src = dataUrl;
    } catch { res(null); }
  });
}

// A fetched + decoded photo ready to embed.
export interface PreparedPhoto {
  dataUrl: string;
  fmt: string;
  dims: { w: number; h: number } | null;
}

/**
 * HW3: lay out component photos two-per-row with noticeably larger thumbnails.
 * Each cell is half the content width, so two cells fill the row. Pagination is
 * kept clean by reserving a full row height before drawing each row. The caller
 * passes getY/setY closures so this works with either report's `y` cursor.
 */
export function drawComponentPhotos(
  doc: any,
  photos: PreparedPhoto[],
  getY: () => number,
  setY: (y: number) => void,
  checkPage: (needed: number) => void,
): void {
  const gap = 6;
  const cellW = (CONT_W - gap) / 2; // two per row
  const cellH = Math.round(cellW * 0.7); // taller cells for bigger photos
  let col = 0;
  photos.forEach((p) => {
    if (col === 0) checkPage(cellH + gap); // reserve a full row before starting it
    const rowX = MARGIN + col * (cellW + gap);
    const y = getY();
    doc.setDrawColor(...XC_BORDER); doc.setLineWidth(0.3);
    doc.roundedRect(rowX, y, cellW, cellH, 1, 1, 'S');
    try {
      const pad = 2;
      let drawW = cellW - pad * 2;
      let drawH = cellH - pad * 2;
      if (p.dims && p.dims.w > 0 && p.dims.h > 0) {
        const ratio = p.dims.h / p.dims.w;
        drawH = drawW * ratio;
        if (drawH > cellH - pad * 2) {
          drawH = cellH - pad * 2;
          drawW = drawH / ratio;
        }
      }
      const ix = rowX + (cellW - drawW) / 2;
      const iy = y + (cellH - drawH) / 2;
      doc.addImage(p.dataUrl, p.fmt, ix, iy, drawW, drawH);
    } catch { /* skip a bad image */ }
    col++;
    if (col === 2) { col = 0; setY(getY() + cellH + gap); }
  });
  if (col !== 0) setY(getY() + cellH + gap);
}

export async function generateCombinedFieldVisitPDF(
  opts: CombinedFieldVisitPDFOptions,
): Promise<Blob | void> {
  const { visit, accessToken, returnBlob = false } = opts;
  const v = visit || {};
  const fvId = v.field_visit_id ?? null;

  // ── Resolve customer / district names if not supplied ──
  let customerName = opts.customerName ?? v.customerName ?? null;
  let districtName = opts.districtName ?? v.districtName ?? null;
  if (customerName == null && districtName == null) {
    const resolved = await resolveSessionNames(v.customer ?? null, v.customer_district ?? null);
    customerName = resolved.customerName;
    districtName = resolved.districtName;
  }

  // ── Fetch the training sessions linked to this visit ──
  let sessions: ChecklistSession[] = [];
  if (fvId) {
    try { sessions = await listSessionsForVisit(String(fvId)); } catch { sessions = []; }
  }

  // ── Fetch the hardware inspection + its items ──
  let inspection: any = null;
  if (fvId) {
    try {
      const byVisit = await hardwareInspectionApi.getByVisit(String(fvId), accessToken ?? undefined);
      if (byVisit && byVisit.row_id) inspection = byVisit;
    } catch { inspection = null; }
  }
  const inspItems: any[] = Array.isArray(inspection?.items) ? inspection.items : [];

  // ── Pre-fetch all component photos (await BEFORE the synchronous render) ──
  // Keyed by component index (1-based) → array of prepared photos.
  const photosByComponent: Record<number, PreparedPhoto[]> = {};
  if (inspection?.row_id && inspItems.length) {
    try {
      const { projectId, publicAnonKey } = await import('/utils/supabase/info');
      const baseUrl = `https://${projectId}.supabase.co/functions/v1/make-server-64775d98`;
      const resp = await fetch(
        `${baseUrl}/images/hardware_inspections/${encodeURIComponent(inspection.row_id)}`,
        { headers: { Authorization: `Bearer ${accessToken || publicAnonKey}` } },
      );
      if (resp.ok) {
        const data = await resp.json();
        const files: any[] = Array.isArray(data.files) ? data.files : [];
        for (let idx = 0; idx < inspItems.length; idx++) {
          const fieldName = `component_${idx + 1}`;
          const matches = files
            .filter((f) => f.fieldName === fieldName && f.url)
            .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
          const prepared: PreparedPhoto[] = [];
          for (const f of matches) {
            const fetched = await fetchSigDataUrl(f.url);
            if (fetched?.dataUrl) {
              prepared.push({
                dataUrl: fetched.dataUrl,
                fmt: pickSigFormat(fetched.mime, f.url),
                dims: await readImageDims(fetched.dataUrl),
              });
            }
          }
          if (prepared.length) photosByComponent[idx + 1] = prepared;
        }
      }
    } catch { /* photos are best-effort — never block the report */ }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // Render
  // ══════════════════════════════════════════════════════════════════════════════
  const doc = await loadJsPDF();
  const colW = CONT_W / 2;
  const TITLE = 'Field Visit Report';
  let y = drawHeader(doc, TITLE) + 10;

  const checkPage = (needed: number) => {
    if (y + needed > PAGE_H - 20) {
      doc.addPage();
      y = drawHeader(doc, TITLE) + 10;
    }
  };

  // ── Two-column grid helper (skips empty values) ──
  const twoColGrid = (fields: { label: string; value?: string | null }[]) => {
    const visible = fields.filter((f) => f.value && f.value !== '—');
    if (!visible.length) return;
    let col = 0;
    visible.forEach((item) => {
      if (col === 0) checkPage(10);
      const x = MARGIN + (col === 0 ? 0 : colW);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...XC_DARK);
      doc.text(`${item.label}:`, x, y);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(60, 60, 60);
      const labelW = doc.getTextWidth(`${item.label}: `);
      const maxW = colW - labelW - 4;
      const txt = doc.splitTextToSize(item.value || '—', maxW)[0];
      doc.text(txt, x + labelW + 1, y);
      col++;
      if (col === 2) { col = 0; y += 8; }
    });
    if (col !== 0) y += 8;
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
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    const lines = doc.splitTextToSize(content, CONT_W - 10);
    const boxH = (lines.length * 6) + 8;
    checkPage(boxH + 6);
    doc.setFillColor(250, 250, 250); doc.setDrawColor(...XC_BORDER); doc.setLineWidth(0.3);
    doc.roundedRect(MARGIN, y, CONT_W, boxH, 1, 1, 'FD');
    doc.setFillColor(...XC_GREEN); doc.rect(MARGIN, y, 1.5, boxH, 'F');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(40, 40, 40);
    lines.forEach((line: string, i: number) => doc.text(line, MARGIN + 6, y + 6.5 + (i * 6)));
    y += boxH + 10;
  };

  // ── Title row ──
  doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(...XC_DARK);
  doc.text('Field Visit Report', MARGIN, y);
  y += 7;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...GRAY_TEXT);
  const subtitle = [
    fvId ? `Field Visit #${fvId}` : null,
    customerName || null,
    v.visit_purpose || null,
  ].filter(Boolean).join('   |   ');
  if (subtitle) { doc.text(subtitle, MARGIN, y); y += 14; } else { y += 6; }

  // ══════════════════════════════════════════════════════════════════════════════
  // 1. Visit Details
  // ══════════════════════════════════════════════════════════════════════════════
  y = drawSectionHeading(doc, 'Visit Details', y);
  twoColGrid([
    { label: 'Customer', value: customerName },
    { label: 'District', value: districtName },
    { label: 'Operating Company', value: v.operating_company },
    { label: 'Visit Purpose', value: v.visit_purpose },
    { label: 'Field / Facility', value: v.field_or_facility },
    { label: 'Pad / Well', value: v.pad_name },
    { label: 'XC Representative', value: v.xc_rep },
    { label: 'Customer Representative', value: v.customer_rep },
    { label: 'Arrival Date', value: fmtDate(v.arrival_date) },
    { label: 'Departure Date', value: fmtDate(v.departure_date) },
    { label: 'Visit Duration', value: fmtDuration(v.visit_duration, v.arrival_date, v.departure_date) },
    { label: 'Communication Panel', value: v.communication_panel },
    { label: 'Digital Shooting Panel', value: v.digital_shooting_panel },
    { label: 'Surface Tester', value: v.surface_tester },
    { label: 'Field Visit ID', value: fvId },
  ]);
  narrativeBlock('Visit Summary', v.visit_summary);

  // ══════════════════════════════════════════════════════════════════════════════
  // 2. Training Checklist(s)
  // ══════════════════════════════════════════════════════════════════════════════
  checkPage(30);
  y = drawSectionHeading(doc, 'Training Checklist', y);
  if (!sessions.length) {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.setTextColor(...GRAY_TEXT);
    doc.text('No training checklist linked to this field visit.', MARGIN, y);
    y += 10;
  } else {
    sessions.forEach((session, si) => {
      if (si > 0) y += 2;
      checkPage(20);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...XC_GREEN);
      const headerTxt = session.template_name || `Checklist ${si + 1}`;
      doc.text(headerTxt, MARGIN, y);
      y += 6;
      twoColGrid([
        { label: 'Product Line', value: session.product_line },
        { label: 'Trainer (SQM)', value: session.trainer_name },
        { label: 'Training Date', value: fmtDate(session.training_date) },
        { label: 'Location', value: session.location },
        { label: 'Status', value: session.status === 'completed' ? 'Completed' : 'In progress' },
        { label: 'Sign-off', value: session.signoff_name },
      ]);

      const steps = Array.isArray(session.step_results) ? session.step_results : [];
      if (steps.length) {
        const doneCount = steps.filter((s) => s.done).length;
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...GRAY_TEXT);
        doc.text(`${doneCount} of ${steps.length} steps completed`, MARGIN, y);
        y += 7;
        steps.forEach((step) => {
          checkPage(12);
          const mark = step.done ? '[x]' : '[  ]';
          if (step.done) doc.setTextColor(...XC_GREEN); else doc.setTextColor(180, 60, 60);
          doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
          doc.text(mark, MARGIN, y);
          doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(40, 40, 40);
          const lines = doc.splitTextToSize(step.text || '—', CONT_W - 14);
          lines.forEach((line: string, i: number) => {
            if (i > 0) checkPage(6);
            doc.text(line, MARGIN + 10, y);
            if (i < lines.length - 1) y += 5.5;
          });
          y += 8;
        });
      } else {
        doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.setTextColor(...GRAY_TEXT);
        doc.text('No checklist steps recorded.', MARGIN, y);
        y += 8;
      }
      narrativeBlock('', session.notes);
    });
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 3. Hardware Inspection
  // ══════════════════════════════════════════════════════════════════════════════
  checkPage(30);
  y = drawSectionHeading(doc, 'Hardware Inspection', y);
  if (!inspection?.row_id || !inspItems.length) {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.setTextColor(...GRAY_TEXT);
    doc.text('No hardware inspection recorded for this visit.', MARGIN, y);
    y += 10;
  } else {
    const overall = STATUS_LABEL[inspection.overall_status] || inspection.overall_status || '—';
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...XC_DARK);
    doc.text(`Overall status: ${overall}`, MARGIN, y);
    y += 7;
    twoColGrid([
      { label: 'Inspector', value: inspection.inspector },
      { label: 'Inspection Date', value: fmtDate(inspection.inspection_date) },
      { label: 'Components Checked', value: String(inspItems.length) },
      {
        label: 'Total Parts',
        value: String(inspItems.reduce((sum, it) => sum + (Number(it.quantity) > 0 ? Number(it.quantity) : 1), 0)),
      },
    ]);
    narrativeBlock('', inspection.notes);

    inspItems.forEach((it, idx) => {
      checkPage(24);
      const qty = Number(it.quantity) > 0 ? Number(it.quantity) : 1;
      const partName = (it.component_name || '').trim() || 'Unspecified part';
      const compHeader = `Component ${idx + 1} — ${it.component_category || '—'}: ${partName} (×${qty})`;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...XC_DARK);
      const headerLines = doc.splitTextToSize(compHeader, CONT_W);
      headerLines.forEach((line: string, i: number) => {
        if (i > 0) checkPage(6);
        doc.text(line, MARGIN, y);
        y += 5.5;
      });

      // Condition
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(60, 60, 60);
      doc.text(`Condition: ${STATUS_LABEL[it.status] || it.status || '—'}`, MARGIN + 2, y);
      y += 6;

      // Flagged checks (only those set true)
      const flagged = CHECK_LABELS.filter((c) => !!(it as any)[c.key]).map((c) => c.label);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
      if (flagged.length) {
        doc.setTextColor(180, 60, 60);
        const flagText = `Issues flagged: ${flagged.join(', ')}`;
        const fLines = doc.splitTextToSize(flagText, CONT_W - 4);
        fLines.forEach((line: string, i: number) => {
          if (i > 0) checkPage(6);
          doc.text(line, MARGIN + 2, y);
          y += 5.5;
        });
      } else {
        doc.setTextColor(...XC_GREEN);
        doc.text('Issues flagged: none', MARGIN + 2, y);
        y += 5.5;
      }

      // Per-item note
      if (it.note) {
        doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.setTextColor(80, 80, 80);
        const nLines = doc.splitTextToSize(`Note: ${it.note}`, CONT_W - 4);
        nLines.forEach((line: string, i: number) => {
          if (i > 0) checkPage(6);
          doc.text(line, MARGIN + 2, y);
          y += 5.5;
        });
      }

      // Embedded photos for this component (HW3: two per row, larger thumbnails).
      const photos = photosByComponent[idx + 1] || [];
      if (photos.length) {
        y += 2;
        drawComponentPhotos(doc, photos, () => y, (ny) => { y = ny; }, checkPage);
      }

      y += 4;
      // Divider between components
      doc.setDrawColor(...XC_BORDER); doc.setLineWidth(0.2);
      doc.line(MARGIN, y, MARGIN + CONT_W, y);
      y += 5;
    });
  }

  drawFooters(doc);

  if (returnBlob) return doc.output('blob') as Blob;
  const idPart = fvId || (inspection?.row_id ? String(inspection.row_id).slice(0, 8) : 'visit');
  doc.save(`FieldVisit_${idPart}.pdf`);
}
