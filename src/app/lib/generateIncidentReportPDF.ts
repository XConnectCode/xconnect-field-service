import {
  loadJsPDF, drawHeader, drawFooters, drawSectionHeading, drawWatermark,
  XC_GREEN, XC_DARK, XC_BORDER, GRAY_TEXT,
  MARGIN, CONT_W, PAGE_H,
} from './pdfUtils';
import { resolveEvidenceList, type IncidentReportImage } from './incidentPdfImages';
import {
  resolveFailedComponentLabel,
  resolveFailureTypeLabel,
  type ComponentMap,
} from './failedComponent';
import { normalizeStatus } from './incidentWorkflow';

export type { IncidentReportImage } from './incidentPdfImages';

export interface IncidentReportOptions {
  incident:    Record<string, any>;
  listMap:     Record<string, { failed_component: string; failure_type: string }>;
  vendorMap:   Record<string, string>;
  customerMap: Record<string, any>;
  districtMap: Record<string, string>;
  /**
   * Optional secondary lookup table for failed_component values that
   * point at `components.row_id` (rather than `lists.row_id`). Without
   * this map, the PDF falls back to the lists table only and may emit a
   * raw row_id for newly-created incidents.
   */
  componentsMap?: ComponentMap;
  returnBlob?: boolean;
  /**
   * Optional explicit list of images (with captions) to include in the
   * "Visual Evidence" section. When provided, takes precedence over the
   * legacy `incident.image1`/`incident.image2` fields. Pass an empty
   * array to skip the section entirely.
   */
  selectedImages?: IncidentReportImage[];
}

const MAX_IMAGE_H = 140; // mm — cap so very tall images don't blow up the layout

/**
 * Map a MIME type or URL extension to the format string jsPDF expects.
 * jsPDF only understands JPEG, PNG, GIF, WEBP — anything else we treat as
 * JPEG (jsPDF will fall back internally) so the image still gets attached.
 */
function pickPdfImageFormat(mime: string | null, url: string): 'JPEG' | 'PNG' | 'GIF' | 'WEBP' {
  const m = (mime || '').toLowerCase();
  if (m.includes('png'))  return 'PNG';
  if (m.includes('gif'))  return 'GIF';
  if (m.includes('webp')) return 'WEBP';
  if (m.includes('jpeg') || m.includes('jpg')) return 'JPEG';
  // Fall back to URL inspection — strip query string first so signed URLs
  // like `.../image.png?token=xyz` are detected correctly.
  const path = url.split('?')[0].toLowerCase();
  if (path.endsWith('.png'))  return 'PNG';
  if (path.endsWith('.gif'))  return 'GIF';
  if (path.endsWith('.webp')) return 'WEBP';
  return 'JPEG';
}

/**
 * Fetch an image URL as a data URL so jsPDF can embed it without depending on
 * cross-origin <img> behaviour. Signed Supabase URLs serve the asset directly;
 * a normal fetch with `cache: 'no-store'` works without CORS preflights for
 * GETs on the storage origin.
 */
async function fetchAsDataUrl(url: string): Promise<{ dataUrl: string; mime: string } | null> {
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
  } catch {
    return null;
  }
}

async function addImagePreserved(doc: any, url: string, x: number, y: number, targetW: number): Promise<number> {
  if (!url) return 0;

  // 1. Pull the bytes ourselves so we don't depend on the <img> CORS dance and
  //    so we can read the real content-type rather than guessing from the URL
  //    extension (which is unreliable for signed storage URLs with tokens).
  const fetched = await fetchAsDataUrl(url);

  return new Promise((resolve) => {
    const img = new Image();
    // Only set crossOrigin when going through the <img> fallback path.
    if (!fetched) img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        let drawW = targetW;
        let drawH = targetW * (img.height / img.width);
        if (!isFinite(drawH) || drawH <= 0) { resolve(0); return; }
        if (drawH > MAX_IMAGE_H) {
          drawH = MAX_IMAGE_H;
          drawW = drawH * (img.width / img.height);
        }
        if (y + drawH > PAGE_H - 20) { resolve(0); return; }
        const fmt = pickPdfImageFormat(fetched?.mime ?? null, url);
        // When we have a data URL prefer it (more reliable across jsPDF
        // versions); fall back to the raw <img> element.
        const payload = fetched?.dataUrl ?? img;
        doc.addImage(payload, fmt, x, y, drawW, drawH);
        resolve(drawH);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('PDF image embed failed:', err);
        resolve(0);
      }
    };
    img.onerror = () => resolve(0);
    img.src = fetched?.dataUrl ?? url;
  });
}

function fmtDate(val?: string): string {
  if (!val) return '—';
  try { return new Date(val + 'T12:00:00').toLocaleDateString(); } catch { return val; }
}

export async function generateIncidentReportPDF(opts: IncidentReportOptions): Promise<Blob | void> {
  const { incident: r, listMap, vendorMap, customerMap, districtMap, componentsMap, returnBlob = false, selectedImages } = opts;
  const doc = await loadJsPDF();

  const colW = CONT_W / 2;

  const customerName = typeof customerMap[r.customer] === 'object'
    ? (customerMap[r.customer] as any).name
    : (customerMap[r.customer] || r.customerName || r.customer || '—');
  const districtName = districtMap[r.customer_district] || r.districtName || r.customer_district || '—';
  const failedComponent = resolveFailedComponentLabel(r.failed_component, componentsMap);
  const failureType     = resolveFailureTypeLabel(r.failure_type, listMap);
  const vendorName      = vendorMap[r.vendor] || r.vendor || '—';
  // Single source of truth for status across cover/subsections so they can't
  // contradict each other (e.g. cover "Final Review" while corrective-action
  // block reads "In Progress"). The cover-page status takes precedence; any
  // legacy "In Progress" / "Open" values are mapped to the canonical workflow.
  const canonicalStatus = normalizeStatus(r.incident_status) || r.incident_status || '';

  // ── Page helpers ─────────────────────────────────────────────────────────────
  let y = drawHeader(doc, 'Field Incident Analysis') + 10;
  drawWatermark(doc);

  const checkPage = (needed: number) => {
    if (y + needed > PAGE_H - 20) {
      doc.addPage();
      y = drawHeader(doc, 'Field Incident Analysis') + 10;
      drawWatermark(doc);
    }
  };

  // ── Narrative block helper ────────────────────────────────────────────────────
  const narrativeBlock = (title: string, content: string) => {
    if (!content) return;
    checkPage(40);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...XC_GREEN);
    doc.text(title, MARGIN, y);
    y += 5;
    const lines = doc.splitTextToSize(content, CONT_W - 10);
    const boxH  = (lines.length * 6) + 8;
    doc.setFillColor(250, 250, 250); doc.setDrawColor(...XC_BORDER); doc.setLineWidth(0.3);
    doc.roundedRect(MARGIN, y, CONT_W, boxH, 1, 1, 'FD');
    doc.setFillColor(...XC_GREEN); doc.rect(MARGIN, y, 1.5, boxH, 'F');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(40, 40, 40);
    lines.forEach((line: string, i: number) => doc.text(line, MARGIN + 6, y + 6.5 + (i * 6)));
    y += boxH + 10;
  };

  // ── Two-column grid helper ────────────────────────────────────────────────────
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

  // ══════════════════════════════════════════════════════════════════════════════
  // Title row
  // ══════════════════════════════════════════════════════════════════════════════
  doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(...XC_DARK);
  doc.text('Incident Analysis Report', MARGIN, y);
  y += 7;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...GRAY_TEXT);
  const subtitle = [
    r.event_id          ? `Event #${r.event_id}`           : null,
    canonicalStatus     ? `Status: ${canonicalStatus}`     : null,
    r.report_version    ? `Version: ${r.report_version}`   : null,
    r.incident_severity ? `Severity: ${r.incident_severity}` : null,
  ].filter(Boolean).join('   |   ');
  doc.text(subtitle, MARGIN, y);
  y += 14;

  // ══════════════════════════════════════════════════════════════════════════════
  // 1. General Information
  // ══════════════════════════════════════════════════════════════════════════════
  y = drawSectionHeading(doc, 'General Information', y);
  twoColGrid([
    { label: 'Date',              value: fmtDate(r.date_incident) },
    { label: 'Field / Facility',  value: r.field_facility },
    { label: 'Customer',          value: customerName },
    { label: 'District',          value: districtName },
    { label: 'Operating Company', value: r.operating_company },
    { label: 'XC Representative', value: r.xc_rep },
    { label: 'XC District',       value: r.xc_district },
    { label: 'Customer Rep',      value: r.customer_rep },
    { label: 'EP Representative', value: r.ep_rep },
    { label: 'Well Name',         value: r.well_name },
    { label: 'Stage #',           value: r['stage#'] },
    { label: 'SO #',              value: r['so#'] },
    { label: 'Field Visit ID',    value: r.field_visit_id },
  ]);

  // ══════════════════════════════════════════════════════════════════════════════
  // 2. Technical Investigation
  // ══════════════════════════════════════════════════════════════════════════════
  checkPage(50);
  y = drawSectionHeading(doc, 'Technical Investigation', y);

  // coloured highlight box
  const isXCFault = r.xc_caused === 'Yes';
  doc.setFillColor(isXCFault ? 254 : 248, isXCFault ? 242 : 252, isXCFault ? 242 : 250);
  const techBoxStart = y - 4;
  // draw box after measuring content
  doc.setFillColor(isXCFault ? 220 : 93, isXCFault ? 38 : 184, isXCFault ? 38 : 72);
  doc.rect(MARGIN, techBoxStart, 2, 44, 'F');

  const techFields = [
    { label: 'Product Line',     value: r.product_line },
    { label: 'Firing System',    value: r.firing_system },
    { label: 'Event Category',   value: r.event_category },
    { label: 'Severity',         value: r.incident_severity },
    { label: 'Failed Component', value: failedComponent },
    { label: 'Failure Type',     value: failureType },
    { label: 'XC Caused',        value: r.xc_caused },
    { label: 'Vendor Caused',    value: r.vendor_caused },
  ].filter(f => f.value);

  let col = 0;
  techFields.forEach(item => {
    if (col === 0) checkPage(10);
    const x = MARGIN + (col === 0 ? 3 : colW);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...XC_DARK);
    doc.text(`${item.label}:`, x, y);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(60, 60, 60);
    const lw  = doc.getTextWidth(`${item.label}: `);
    const txt = doc.splitTextToSize(item.value || '—', colW - lw - 4)[0];
    doc.text(txt, x + lw + 1, y);
    col++;
    if (col === 2) { col = 0; y += 8; }
  });
  if (col !== 0) y += 8;
  y += 10;

  // ══════════════════════════════════════════════════════════════════════════════
  // 3. Incident Narrative
  // ══════════════════════════════════════════════════════════════════════════════
  const hasNarrative = r.incident_description || r.investigation || r.root_cause;
  if (hasNarrative) {
    checkPage(30);
    y = drawSectionHeading(doc, 'Incident Narrative', y);
    narrativeBlock('Incident Description',      r.incident_description);
    narrativeBlock('Investigation Findings',    r.investigation);
    narrativeBlock('Root Cause Identification', r.root_cause);
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 4. Corrective & Preventive Actions
  // ══════════════════════════════════════════════════════════════════════════════
  const hasActions = r.corrective_action || r.preventive_action || r.action_assigned_to || r.action_due_date || r.action_status;
  if (hasActions) {
    checkPage(30);
    y = drawSectionHeading(doc, 'Corrective & Preventive Actions', y);
    narrativeBlock('Corrective Action',  r.corrective_action);
    narrativeBlock('Preventive Action',  r.preventive_action);

    // action meta row
    // Label this "Action Status" explicitly so it cannot be mistaken for the
    // overall incident status shown on the cover. When the incident is fully
    // Closed, force the action status to match so the two cannot contradict
    // ("Closed" incident with an "In Progress" corrective action makes no
    // sense to a customer reading the PDF).
    const effectiveActionStatus =
      canonicalStatus === 'Closed'
        ? (r.action_status && /complete|closed|done/i.test(String(r.action_status))
            ? r.action_status
            : 'Completed')
        : r.action_status;

    const actionMeta = [
      { label: 'Assigned To',   value: r.action_assigned_to },
      { label: 'Due Date',      value: fmtDate(r.action_due_date) },
      { label: 'Action Status', value: effectiveActionStatus },
    ].filter(f => f.value && f.value !== '—');

    if (actionMeta.length) {
      checkPage(20);
      // pill-style row
      doc.setFillColor(245, 247, 250); doc.setDrawColor(...XC_BORDER); doc.setLineWidth(0.3);
      doc.roundedRect(MARGIN, y, CONT_W, 14, 2, 2, 'FD');
      let px = MARGIN + 6;
      actionMeta.forEach((f, i) => {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...XC_DARK);
        doc.text(`${f.label}:`, px, y + 9);
        px += doc.getTextWidth(`${f.label}: `) + 1;
        doc.setFont('helvetica', 'normal'); doc.setTextColor(60, 60, 60);
        doc.text(f.value || '', px, y + 9);
        px += doc.getTextWidth(f.value || '') + 10;
        if (i < actionMeta.length - 1) {
          doc.setDrawColor(200, 200, 200); doc.setLineWidth(0.3);
          doc.line(px - 5, y + 3, px - 5, y + 11);
        }
      });
      y += 22;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 5. Closure
  // ══════════════════════════════════════════════════════════════════════════════
  const hasClosure = r.closed_date || r.closed_by;
  if (hasClosure) {
    checkPage(30);
    y = drawSectionHeading(doc, 'Closure', y);
    twoColGrid([
      { label: 'Closed Date', value: fmtDate(r.closed_date) },
      { label: 'Closed By',   value: r.closed_by },
    ]);
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 6. Notes
  // ══════════════════════════════════════════════════════════════════════════════
  if (r.notes) {
    checkPage(30);
    y = drawSectionHeading(doc, 'Notes', y);
    narrativeBlock('', r.notes);
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 7. Visual Evidence
  // ══════════════════════════════════════════════════════════════════════════════
  const evidence = resolveEvidenceList(r, selectedImages);

  if (evidence.length) {
    checkPage(60);
    y = drawSectionHeading(doc, 'Visual Evidence', y);

    for (const item of evidence) {
      // Reserve space for caption (≈6mm) plus a reasonable image area; the
      // helper will skip the image if it would still overflow the page.
      checkPage(90);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...XC_DARK);
      const captionLines = doc.splitTextToSize(item.label, CONT_W);
      captionLines.forEach((line: string, i: number) => doc.text(line, MARGIN, y + (i * 5)));
      y += (captionLines.length * 5) + 1;
      const h = await addImagePreserved(doc, item.url, MARGIN, y, 110);
      if (h > 0) {
        y += h + 12;
      } else {
        doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.setTextColor(...GRAY_TEXT);
        doc.text('(Image unavailable — see digital record)', MARGIN, y + 6);
        y += 16;
      }
    }
  }

  drawFooters(doc);

  if (returnBlob) return doc.output('blob') as Blob;
  doc.save(`Incident_${r.event_id || 'XC'}_Report.pdf`);
}
