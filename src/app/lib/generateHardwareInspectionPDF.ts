/**
 * Isolated Hardware Inspection PDF (HW5).
 *
 * A hardware-only report an SQM can generate straight from the Hardware
 * Inspection card — the hardware counterpart to the Training Checklist "Report".
 * It contains just the inspection: header context, overall status, per-component
 * wear checks / condition / notes, and embedded component photos (two-per-row,
 * larger thumbnails — shared with the combined report via drawComponentPhotos).
 *
 * Reuses the shared PDF infra in ./pdfUtils and the photo layout helper in
 * ./generateCombinedFieldVisitPDF so the two reports stay visually consistent.
 */
import {
  loadJsPDF, drawHeader, drawFooters, drawSectionHeading,
  XC_GREEN, XC_DARK, XC_BORDER, GRAY_TEXT,
  MARGIN, CONT_W, PAGE_H,
} from './pdfUtils';
import { resolveSessionNames } from './trainingChecklists';
import { hardwareInspectionApi } from './api';
import { drawComponentPhotos, type PreparedPhoto } from './generateCombinedFieldVisitPDF';
import { projectId, publicAnonKey } from '../../../utils/supabase/info';

export interface HardwareInspectionPDFOptions {
  /** Full field visit record (fieldvisits row), for header context. Optional. */
  visit?: Record<string, any> | null;
  /** The hardware inspection record (with .items). If omitted, it's fetched by visit. */
  inspection?: Record<string, any> | null;
  customerName?: string | null;
  districtName?: string | null;
  accessToken?: string | null;
  returnBlob?: boolean;
}

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

function fmtDate(val?: string | null): string {
  if (!val) return '—';
  try {
    const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(val);
    const d = new Date(isDateOnly ? val + 'T12:00:00' : val);
    return isNaN(d.getTime()) ? val : d.toLocaleDateString();
  } catch { return val; }
}

function pickSigFormat(mime: string | null, url: string): string {
  const m = (mime || '').toLowerCase();
  if (m.includes('jpeg') || m.includes('jpg')) return 'JPEG';
  if (m.includes('webp')) return 'WEBP';
  const path = url.split('?')[0].toLowerCase();
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'JPEG';
  if (path.endsWith('.webp')) return 'WEBP';
  return 'PNG';
}

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

export async function generateHardwareInspectionPDF(
  opts: HardwareInspectionPDFOptions,
): Promise<Blob | void> {
  const { visit, accessToken, returnBlob = false } = opts;
  const v = visit || {};
  const fvId = v.field_visit_id ?? null;

  // ── Resolve the inspection (fetch by visit when not provided) ──
  let inspection = opts.inspection ?? null;
  if (!inspection && fvId) {
    try {
      const byVisit = await hardwareInspectionApi.getByVisit(String(fvId), accessToken ?? undefined);
      if (byVisit && byVisit.row_id) inspection = byVisit;
    } catch { inspection = null; }
  }
  const inspItems: any[] = Array.isArray(inspection?.items) ? inspection.items : [];

  // ── Resolve customer / district names ──
  let customerName = opts.customerName ?? v.customerName ?? null;
  let districtName = opts.districtName ?? v.districtName ?? null;
  if (customerName == null && districtName == null) {
    const resolved = await resolveSessionNames(
      v.customer ?? inspection?.customer ?? null,
      v.customer_district ?? inspection?.customer_district ?? null,
    );
    customerName = resolved.customerName;
    districtName = resolved.districtName;
  }

  // ── Pre-fetch all component photos before the synchronous render ──
  const photosByComponent: Record<number, PreparedPhoto[]> = {};
  if (inspection?.row_id && inspItems.length) {
    try {
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
    } catch { /* photos are best-effort */ }
  }

  // ── Render ──
  const doc = await loadJsPDF();
  const colW = CONT_W / 2;
  const TITLE = 'Hardware Inspection Report';
  let y = drawHeader(doc, TITLE) + 10;

  const checkPage = (needed: number) => {
    if (y + needed > PAGE_H - 20) {
      doc.addPage();
      y = drawHeader(doc, TITLE) + 10;
    }
  };

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
  doc.text('Hardware Inspection Report', MARGIN, y);
  y += 7;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...GRAY_TEXT);
  const subtitle = [
    fvId ? `Field Visit #${fvId}` : null,
    customerName || null,
    districtName || null,
  ].filter(Boolean).join('   |   ');
  if (subtitle) { doc.text(subtitle, MARGIN, y); y += 14; } else { y += 6; }

  // ── Inspection ──
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
      { label: 'Customer', value: customerName },
      { label: 'District', value: districtName },
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

      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(60, 60, 60);
      doc.text(`Condition: ${STATUS_LABEL[it.status] || it.status || '—'}`, MARGIN + 2, y);
      y += 6;

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

      if (it.note) {
        doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.setTextColor(80, 80, 80);
        const nLines = doc.splitTextToSize(`Note: ${it.note}`, CONT_W - 4);
        nLines.forEach((line: string, i: number) => {
          if (i > 0) checkPage(6);
          doc.text(line, MARGIN + 2, y);
          y += 5.5;
        });
      }

      const photos = photosByComponent[idx + 1] || [];
      if (photos.length) {
        y += 2;
        drawComponentPhotos(doc, photos, () => y, (ny) => { y = ny; }, checkPage);
      }

      y += 4;
      doc.setDrawColor(...XC_BORDER); doc.setLineWidth(0.2);
      doc.line(MARGIN, y, MARGIN + CONT_W, y);
      y += 5;
    });
  }

  drawFooters(doc);

  if (returnBlob) return doc.output('blob') as Blob;
  const idPart = fvId || (inspection?.row_id ? String(inspection.row_id).slice(0, 8) : 'inspection');
  doc.save(`HardwareInspection_${idPart}.pdf`);
}
