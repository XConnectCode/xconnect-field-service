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

export interface DistrictSummaryInspectionComponent {
  component_category?: string | null;   // e.g. "Firing Head"
  component_name?: string | null;       // specific part
  status?: string | null;               // pass | monitor | replace_soon | remove
  quantity?: number;
  note?: string | null;                 // reason / detail
  issues?: string[];                    // human labels of flagged chk_* checks
}

export interface DistrictSummaryInspection {
  inspector?: string | null;
  inspection_date?: string | null;
  overall_status?: string | null;
  componentCount?: number;
  totalParts?: number;
  components?: DistrictSummaryInspectionComponent[];
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

type RGB = [number, number, number];

// Status -> text color, consistent with the app's status semantics.
const HW_STATUS_COLOR: Record<string, RGB> = {
  pass: [...XC_GREEN] as RGB,
  monitor: [200, 130, 0],
  replace_soon: [200, 90, 30],
  remove: [185, 40, 40],
};

// Short customer-facing action hint per urgent status.
const HW_STATUS_HINT: Record<string, string> = {
  replace_soon: 'order replacements ASAP',
  remove: 'remove from service immediately',
  monitor: 'monitor / re-inspect',
};

// Severity ranking for sorting (most severe first).
const HW_STATUS_SEVERITY: Record<string, number> = {
  remove: 0,
  replace_soon: 1,
  monitor: 2,
  pass: 3,
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
      if (col === 0) checkPage(11);
      const x = MARGIN + (col === 0 ? 0 : colW);
      // Label: normal weight, size 9.
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90, 90, 90);
      doc.text(`${item.label}:`, x, y);
      const labelW = doc.getTextWidth(`${item.label}: `);
      // Value: bold + larger, clearly separated from the label.
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...XC_DARK);
      const maxW = colW - labelW - 6;
      const txt = doc.splitTextToSize(item.value || '—', maxW)[0];
      doc.text(txt, x + labelW + 4, y);
      col++;
      if (col === 2) { col = 0; y += 10; }
    });
    if (col !== 0) y += 10;
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

  // ── Overall status breakdown (colored + non-pass bold) ──
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...GRAY_TEXT);
  doc.text('Overall status breakdown', MARGIN, y); y += 6;
  {
    const keys = Object.keys(data.inspectionStatusCounts).filter(
      (k) => data.inspectionStatusCounts[k] > 0,
    );
    if (!keys.length) {
      doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.setTextColor(...GRAY_TEXT);
      doc.text('None in this period.', MARGIN + 2, y);
      y += 7;
    } else {
      keys.sort((a, b) => (HW_STATUS_SEVERITY[a] ?? 9) - (HW_STATUS_SEVERITY[b] ?? 9));
      keys.forEach((k) => {
        checkPage(7);
        const color = HW_STATUS_COLOR[k] || ([50, 50, 50] as RGB);
        doc.setFont('helvetica', k === 'pass' ? 'normal' : 'bold');
        doc.setFontSize(9); doc.setTextColor(...color);
        doc.text(`• ${HW_STATUS_LABEL[k] || k}: ${data.inspectionStatusCounts[k]}`, MARGIN + 2, y);
        y += 6;
      });
      y += 2;
    }
  }

  // ── Needs attention: rollup by component category + status ──
  {
    const groups = new Map<string, {
      category: string; status: string; qty: number;
      notes: Set<string>; issues: Set<string>;
    }>();
    for (const insp of data.inspections) {
      for (const c of insp.components || []) {
        const category = (c.component_category || c.component_name || 'Unspecified').trim() || 'Unspecified';
        const status = c.status || 'pass';
        const key = `${category}||${status}`;
        let g = groups.get(key);
        if (!g) { g = { category, status, qty: 0, notes: new Set(), issues: new Set() }; groups.set(key, g); }
        g.qty += c.quantity && c.quantity > 0 ? c.quantity : 1;
        if (c.note && c.note.trim()) g.notes.add(c.note.trim());
        for (const iss of c.issues || []) if (iss) g.issues.add(iss);
      }
    }

    const rows = Array.from(groups.values());
    checkPage(10);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...GRAY_TEXT);
    doc.text('Needs attention', MARGIN, y); y += 6;

    const nonPass = rows.filter((r) => r.status !== 'pass');
    if (!rows.length) {
      doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.setTextColor(...GRAY_TEXT);
      doc.text('No component detail available for this period.', MARGIN + 2, y);
      y += 7;
    } else if (!nonPass.length) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...XC_GREEN);
      doc.text('All inspected components passed.', MARGIN + 2, y);
      y += 7;
    } else {
      nonPass.sort((a, b) => {
        const sa = HW_STATUS_SEVERITY[a.status] ?? 9;
        const sb = HW_STATUS_SEVERITY[b.status] ?? 9;
        if (sa !== sb) return sa - sb;
        return b.qty - a.qty;
      });
      nonPass.forEach((r) => {
        checkPage(8);
        const color = HW_STATUS_COLOR[r.status] || ([50, 50, 50] as RGB);
        const statusLabel = HW_STATUS_LABEL[r.status] || r.status;
        const hint = HW_STATUS_HINT[r.status];
        const head = `• ${r.qty} × ${r.category} — ${statusLabel}${hint ? ` — ${hint}` : ''}`;
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...color);
        const headLines = doc.splitTextToSize(head, CONT_W - 4);
        headLines.forEach((line: string, i: number) => {
          if (i > 0) checkPage(6);
          doc.text(line, MARGIN + 2, y);
          y += 5.5;
        });
        // Reason line from distinct notes + issues.
        const reasonParts = [
          ...Array.from(r.notes),
          r.issues.size ? `Flags: ${Array.from(r.issues).join(', ')}` : '',
        ].filter(Boolean);
        if (reasonParts.length) {
          let reason = `Reason: ${reasonParts.join('; ')}`;
          if (reason.length > 220) reason = reason.slice(0, 217) + '…';
          doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(90, 90, 90);
          const rLines = doc.splitTextToSize(reason, CONT_W - 14);
          rLines.forEach((line: string) => {
            checkPage(6);
            doc.text(line, MARGIN + 8, y);
            y += 5;
          });
        }
        y += 1.5;
      });

      // Single summary line for the components that passed.
      const passQty = rows.filter((r) => r.status === 'pass').reduce((s, r) => s + r.qty, 0);
      if (passQty > 0) {
        checkPage(7);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...XC_GREEN);
        doc.text(`• All other components: Pass (${passQty})`, MARGIN + 2, y);
        y += 6;
      }
      y += 2;
    }
  }

  // ── Per-inspection one-liner list (status token colored) ──
  if (data.inspections.length) {
    data.inspections.forEach((insp) => {
      checkPage(9);
      const status = insp.overall_status || '';
      const color = HW_STATUS_COLOR[status] || ([50, 50, 50] as RGB);
      const statusLabel = status ? (HW_STATUS_LABEL[status] || status) : '';
      // Prefix (date) — normal gray.
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(50, 50, 50);
      let x = MARGIN + 2;
      const prefix = `• ${fmtDate(insp.inspection_date)}  ·  `;
      doc.text(prefix, x, y);
      x += doc.getTextWidth(prefix);
      // Status token — colored, bold if non-pass.
      if (statusLabel) {
        doc.setFont('helvetica', status && status !== 'pass' ? 'bold' : 'normal');
        doc.setTextColor(...color);
        doc.text(statusLabel, x, y);
        x += doc.getTextWidth(statusLabel);
      }
      // Remainder — normal gray.
      doc.setFont('helvetica', 'normal'); doc.setTextColor(50, 50, 50);
      const rest = [
        insp.inspector ? `Inspector: ${insp.inspector}` : null,
        `${insp.componentCount || 0} component${(insp.componentCount || 0) === 1 ? '' : 's'}`,
        `${insp.totalParts || 0} parts`,
      ].filter(Boolean).join('  ·  ');
      doc.text(`  ·  ${rest}`, x, y);
      y += 6;
    });
  }

  drawFooters(doc);

  if (returnBlob) return doc.output('blob') as Blob;
  const namePart = (data.districtName || 'district').replace(/[^a-z0-9]+/gi, '_').slice(0, 30);
  doc.save(`DistrictSummary_${namePart}_${data.periodLabel}.pdf`);
}
