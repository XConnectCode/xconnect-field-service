/**
 * District Visit / Checklist Summary PDF.
 *
 * Aggregates one district's field visits, training checklists and hardware
 * inspections over a selected period (Weekly / Monthly / Quarterly) into a
 * single printable summary. Reuses the shared PDF infra in ./pdfUtils. Dates
 * are treated as naive wall-clock (no timezone conversion), per the app rule.
 */
import {
  loadJsPDF, drawHeader, drawFooters, drawSectionHeading,
  XC_GREEN, XC_DARK, XC_BORDER, GRAY_TEXT,
  MARGIN, CONT_W, PAGE_H,
} from './pdfUtils';

export interface DistrictSummaryVisit {
  field_visit_id?: string | null;
  arrival_date?: string | null;
  xc_rep?: string | null;
  visit_purpose?: string | null;
  customerName?: string | null;
  pad_name?: string | null;
}

export interface DistrictSummaryChecklist {
  template_name?: string | null;
  status?: string | null;
  training_date?: string | null;
  trainer_name?: string | null;
}

export interface DistrictSummaryInspection {
  inspector?: string | null;
  inspection_date?: string | null;
  overall_status?: string | null;
  componentCount?: number;
  totalParts?: number;
}

export interface DistrictSummaryData {
  districtName: string | null;
  customerName: string | null;
  periodLabel: string;          // "Weekly" / "Monthly" / "Quarterly"
  rangeStart: Date;
  rangeEnd: Date;
  visits: DistrictSummaryVisit[];
  checklists: DistrictSummaryChecklist[];
  checklistStatusCounts: Record<string, number>;   // e.g. { completed: 3, in_progress: 1 }
  inspections: DistrictSummaryInspection[];
  inspectionStatusCounts: Record<string, number>;  // pass/monitor/replace_soon/remove
  totalComponentsInspected: number;                 // sum of item quantities
}

export interface DistrictSummaryPDFOptions {
  data: DistrictSummaryData;
  returnBlob?: boolean;
}

const HW_STATUS_LABEL: Record<string, string> = {
  pass: 'Pass',
  monitor: 'Monitor',
  replace_soon: 'Replace soon',
  remove: 'Remove from service',
};

const CHECKLIST_STATUS_LABEL: Record<string, string> = {
  completed: 'Completed',
  in_progress: 'In progress',
};

function fmtDate(val?: string | null): string {
  if (!val) return '—';
  try {
    const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(val);
    const d = new Date(isDateOnly ? val + 'T12:00:00' : val);
    return isNaN(d.getTime()) ? val : d.toLocaleDateString();
  } catch { return val; }
}

export async function generateDistrictSummaryPDF(
  opts: DistrictSummaryPDFOptions,
): Promise<Blob | void> {
  const { data, returnBlob = false } = opts;
  const doc = await loadJsPDF();
  const colW = CONT_W / 2;
  const TITLE = 'District Summary';
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

  // Render a "Label: count" breakdown line list.
  const breakdownList = (counts: Record<string, number>, labelMap: Record<string, string>) => {
    const keys = Object.keys(counts).filter((k) => counts[k] > 0);
    if (!keys.length) {
      doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.setTextColor(...GRAY_TEXT);
      doc.text('None in this period.', MARGIN + 2, y);
      y += 7;
      return;
    }
    keys.forEach((k) => {
      checkPage(7);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(50, 50, 50);
      doc.text(`• ${labelMap[k] || k}: ${counts[k]}`, MARGIN + 2, y);
      y += 6;
    });
    y += 2;
  };

  // ── Title row ──
  doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(...XC_DARK);
  doc.text('District Summary', MARGIN, y);
  y += 7;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...GRAY_TEXT);
  const subtitle = [
    data.districtName || null,
    data.customerName || null,
    `${data.periodLabel} · ${data.rangeStart.toLocaleDateString()} – ${data.rangeEnd.toLocaleDateString()}`,
  ].filter(Boolean).join('   |   ');
  doc.text(subtitle, MARGIN, y);
  y += 14;

  // ══════════════════════════════════════════════════════════════════════════════
  // Totals
  // ══════════════════════════════════════════════════════════════════════════════
  y = drawSectionHeading(doc, 'Period Totals', y);
  twoColGrid([
    { label: 'Field Visits', value: String(data.visits.length) },
    { label: 'Training Checklists', value: String(data.checklists.length) },
    { label: 'Hardware Inspections', value: String(data.inspections.length) },
    { label: 'Components Inspected', value: String(data.totalComponentsInspected) },
  ]);

  // ══════════════════════════════════════════════════════════════════════════════
  // Field Visits
  // ══════════════════════════════════════════════════════════════════════════════
  checkPage(24);
  y = drawSectionHeading(doc, 'Field Visits', y);
  if (!data.visits.length) {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.setTextColor(...GRAY_TEXT);
    doc.text('No field visits in this period.', MARGIN, y);
    y += 10;
  } else {
    data.visits.forEach((v) => {
      checkPage(12);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...XC_DARK);
      const head = `${fmtDate(v.arrival_date)} — ${v.visit_purpose || 'Visit'}`;
      doc.text(head, MARGIN, y);
      y += 5;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(70, 70, 70);
      const detail = [
        v.field_visit_id ? `#${v.field_visit_id}` : null,
        v.xc_rep ? `Rep: ${v.xc_rep}` : null,
        v.customerName || null,
        v.pad_name ? `Pad: ${v.pad_name}` : null,
      ].filter(Boolean).join('  ·  ');
      const lines = doc.splitTextToSize(detail || '—', CONT_W - 4);
      lines.forEach((line: string, i: number) => {
        if (i > 0) checkPage(6);
        doc.text(line, MARGIN + 2, y);
        y += 5;
      });
      y += 3;
    });
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // Training Checklists
  // ══════════════════════════════════════════════════════════════════════════════
  checkPage(24);
  y = drawSectionHeading(doc, 'Training Checklists', y);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...GRAY_TEXT);
  doc.text('Status breakdown', MARGIN, y); y += 6;
  breakdownList(data.checklistStatusCounts, CHECKLIST_STATUS_LABEL);
  if (data.checklists.length) {
    data.checklists.forEach((cl) => {
      checkPage(9);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(50, 50, 50);
      const txt = [
        cl.template_name || 'Checklist',
        cl.status ? (CHECKLIST_STATUS_LABEL[cl.status] || cl.status) : null,
        cl.trainer_name ? `SQM: ${cl.trainer_name}` : null,
        fmtDate(cl.training_date),
      ].filter(Boolean).join('  ·  ');
      const lines = doc.splitTextToSize(`• ${txt}`, CONT_W - 4);
      lines.forEach((line: string, i: number) => {
        if (i > 0) checkPage(6);
        doc.text(line, MARGIN + 2, y);
        y += 5;
      });
      y += 1;
    });
    y += 2;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // Hardware Inspections
  // ══════════════════════════════════════════════════════════════════════════════
  checkPage(24);
  y = drawSectionHeading(doc, 'Hardware Inspections', y);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...GRAY_TEXT);
  doc.text('Overall status breakdown', MARGIN, y); y += 6;
  breakdownList(data.inspectionStatusCounts, HW_STATUS_LABEL);
  if (data.inspections.length) {
    data.inspections.forEach((insp) => {
      checkPage(9);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(50, 50, 50);
      const txt = [
        fmtDate(insp.inspection_date),
        insp.overall_status ? (HW_STATUS_LABEL[insp.overall_status] || insp.overall_status) : null,
        insp.inspector ? `Inspector: ${insp.inspector}` : null,
        `${insp.componentCount || 0} component${(insp.componentCount || 0) === 1 ? '' : 's'}`,
        `${insp.totalParts || 0} parts`,
      ].filter(Boolean).join('  ·  ');
      const lines = doc.splitTextToSize(`• ${txt}`, CONT_W - 4);
      lines.forEach((line: string, i: number) => {
        if (i > 0) checkPage(6);
        doc.text(line, MARGIN + 2, y);
        y += 5;
      });
      y += 1;
    });
  }

  drawFooters(doc);

  if (returnBlob) return doc.output('blob') as Blob;
  const namePart = (data.districtName || 'district').replace(/[^a-z0-9]+/gi, '_').slice(0, 30);
  doc.save(`DistrictSummary_${namePart}_${data.periodLabel}.pdf`);
}
