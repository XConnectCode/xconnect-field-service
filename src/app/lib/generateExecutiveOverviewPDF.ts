import {
  loadJsPDF, drawHeader, drawFooters, drawSectionHeading, drawTable,
  XC_GREEN, XC_DARK, XC_BORDER, GRAY_TEXT,
  MARGIN, CONT_W, PAGE_H,
} from './pdfUtils';

export interface ExecTrendRow {
  month: string;
  total_incidents: number;
  xc_caused_incidents: number;
}

export interface ExecAgingRow {
  age_bucket: string;
  open_count: number;
  xc_caused_count: number;
}

export interface ExecCustomerRow {
  customer_name: string;
  xc_caused_incidents: number;
  total_incidents: number;
  total_stages: number;
}

export interface ExecDistrictRow {
  customer_district: string;
  customer_name: string;
  xc_caused_incidents: number;
  stages_per_xc_incident: number;
}

export interface ExecTotals {
  totalIncidents: number;
  openNewCount: number;
  xcRate: number | null;
  xcCausedCount: number;
  totalOpen: number;
  aged90: number;
  totalStages: number;
  totalBarrels: number;
  totalXfirePanels: number;
  leasedXfirePanels: number;
}

export interface ExecFilters {
  customer?: string;
  district?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}

export interface ExecutiveOverviewArgs {
  totals: ExecTotals;
  trend: ExecTrendRow[];
  aging: ExecAgingRow[];
  customers: ExecCustomerRow[];
  districts: ExecDistrictRow[];
  filters: ExecFilters;
  filtersActive: boolean;
}

const XC_RED: [number, number, number] = [220, 38, 38];
const BAR_GREY: [number, number, number] = [226, 232, 240];

function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  const v = Number(n);
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M';
  if (v >= 1_000) return (v / 1_000).toFixed(1) + 'K';
  return v.toLocaleString();
}

function monthLabel(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

export async function generateExecutiveOverviewPDF(args: ExecutiveOverviewArgs): Promise<void> {
  const { totals, trend, aging, customers, districts, filters, filtersActive } = args;
  const doc = await loadJsPDF();

  let y = drawHeader(doc, new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }));
  y += 8;

  // ── Title block ─────────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(...XC_DARK);
  doc.text('Executive Overview', MARGIN, y + 8);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...GRAY_TEXT);
  doc.text('Read-only summary across all customers and districts', MARGIN, y + 14);

  y += 18;

  if (filtersActive) {
    const parts: string[] = [];
    if (filters.customer) parts.push(`Customer: ${filters.customer}`);
    if (filters.district) parts.push(`District: ${filters.district}`);
    if (filters.dateFrom) parts.push(`From: ${filters.dateFrom}`);
    if (filters.dateTo) parts.push(`To: ${filters.dateTo}`);
    if (filters.search) parts.push(`Search: "${filters.search}"`);
    if (parts.length) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8);
      doc.setTextColor(...XC_RED);
      doc.text(`Active filters — ${parts.join('  ·  ')}`, MARGIN, y + 2);
      y += 6;
    }
  }

  // ── KPI summary cards ───────────────────────────────────────────────────────
  const kpis = [
    { label: 'Total Incidents', value: fmtNum(totals.totalIncidents), sub: `${fmtNum(totals.openNewCount)} currently open (New)` },
    { label: 'XC-Caused Rate', value: totals.xcRate != null ? `${totals.xcRate}%` : '—', sub: `${fmtNum(totals.xcCausedCount)} of ${fmtNum(totals.totalIncidents)} (trailing)` },
    { label: 'Aged Open (90+ d)', value: fmtNum(totals.aged90), sub: `of ${fmtNum(totals.totalOpen)} open` },
    { label: 'Total Stages', value: fmtNum(totals.totalStages), sub: `${fmtNum(totals.totalBarrels)} barrels` },
    { label: 'XFire Panels', value: fmtNum(totals.totalXfirePanels), sub: `${fmtNum(totals.leasedXfirePanels)} leased` },
  ];

  const cardGap = 4;
  const cardCount = kpis.length;
  const cardW = (CONT_W - cardGap * (cardCount - 1)) / cardCount;
  const cardH = 22;
  kpis.forEach((k, i) => {
    const x = MARGIN + i * (cardW + cardGap);
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(...XC_BORDER);
    doc.setLineWidth(0.4);
    doc.roundedRect(x, y, cardW, cardH, 1.5, 1.5, 'FD');
    doc.setFillColor(...XC_GREEN);
    doc.rect(x, y, 1.5, cardH, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.5);
    doc.setTextColor(...GRAY_TEXT);
    doc.text(k.label.toUpperCase(), x + 4, y + 5);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(...XC_DARK);
    doc.text(k.value, x + 4, y + 13);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.5);
    doc.setTextColor(...GRAY_TEXT);
    const subLines = doc.splitTextToSize(k.sub, cardW - 6);
    doc.text(subLines[0] || '', x + 4, y + 18);
  });

  y += cardH + 10;

  // ── Incident Trend chart (THE KEY FIX: rect fills, not CSS backgrounds) ──────
  y = drawSectionHeading(doc, 'Incident Trend (last 12 months)', y);

  if (!trend.length) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...GRAY_TEXT);
    doc.text('No incident data.', MARGIN, y + 6);
    y += 12;
  } else {
    // Legend
    doc.setFillColor(...BAR_GREY);
    doc.rect(MARGIN, y, 4, 4, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...GRAY_TEXT);
    doc.text('Total', MARGIN + 6, y + 3.4);
    doc.setFillColor(...XC_RED);
    doc.rect(MARGIN + 24, y, 4, 4, 'F');
    doc.text('XC-caused', MARGIN + 30, y + 3.4);
    y += 8;

    const chartH = 45;
    const labelArea = 8;
    const baseline = y + chartH;
    const max = Math.max(1, ...trend.map((r) => r.total_incidents));
    const colCount = trend.length;
    const slotW = CONT_W / colCount;
    const barW = Math.min(slotW * 0.7, 12);

    trend.forEach((r, i) => {
      const slotX = MARGIN + i * slotW;
      const barX = slotX + (slotW - barW) / 2;
      const totalH = (r.total_incidents / max) * chartH;
      const xcH = (r.xc_caused_incidents / max) * chartH;
      // grey total bar
      doc.setFillColor(...BAR_GREY);
      doc.rect(barX, baseline - totalH, barW, totalH, 'F');
      // overlaid red xc bar (narrower, centered)
      const xcW = barW * 0.6;
      doc.setFillColor(...XC_RED);
      doc.rect(barX + (barW - xcW) / 2, baseline - xcH, xcW, xcH, 'F');
      // count above bar
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6);
      doc.setTextColor(...XC_DARK);
      doc.text(String(r.total_incidents), slotX + slotW / 2, baseline - totalH - 1.5, { align: 'center' });
      // month label below baseline
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(5.5);
      doc.setTextColor(...GRAY_TEXT);
      doc.text(monthLabel(r.month), slotX + slotW / 2, baseline + 4, { align: 'center' });
    });

    // baseline rule
    doc.setDrawColor(...XC_BORDER);
    doc.setLineWidth(0.4);
    doc.line(MARGIN, baseline, MARGIN + CONT_W, baseline);

    y = baseline + labelArea + 6;
  }

  // ── Open Incident Aging ─────────────────────────────────────────────────────
  if (y + 30 > PAGE_H - 15) { doc.addPage(); y = drawHeader(doc) + 12; }
  y = drawSectionHeading(doc, 'Open Incident Aging', y);
  if (!aging.length) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...GRAY_TEXT);
    doc.text('No open incidents.', MARGIN, y + 6);
    y += 12;
  } else {
    const agingRows = aging.map((r) => [r.age_bucket, String(r.open_count), String(r.xc_caused_count)]);
    const agingCols = [CONT_W * 0.5, CONT_W * 0.25, CONT_W * 0.25];
    y = drawTable(doc, ['Age Bucket', 'Open', 'XC-Caused'], agingRows, agingCols, y) + 8;
  }

  // ── Top Customers by XC-Caused Incidents ────────────────────────────────────
  if (y + 30 > PAGE_H - 15) { doc.addPage(); y = drawHeader(doc) + 12; }
  y = drawSectionHeading(doc, 'Top Customers by XC-Caused Incidents', y);
  if (!customers.length) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...GRAY_TEXT);
    doc.text('No customer data.', MARGIN, y + 6);
    y += 12;
  } else {
    const custRows = customers.map((c) => [
      c.customer_name || '—',
      String(c.xc_caused_incidents ?? 0),
      String(c.total_incidents ?? 0),
      fmtNum(c.total_stages),
    ]);
    const custCols = [CONT_W * 0.46, CONT_W * 0.18, CONT_W * 0.18, CONT_W * 0.18];
    y = drawTable(doc, ['Customer', 'XC-Caused', 'Total', 'Stages'], custRows, custCols, y) + 8;
  }

  // ── Districts — Stages per XC Incident ──────────────────────────────────────
  if (y + 30 > PAGE_H - 15) { doc.addPage(); y = drawHeader(doc) + 12; }
  y = drawSectionHeading(doc, 'Districts — Stages per XC Incident', y);
  if (!districts.length) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...GRAY_TEXT);
    doc.text('No district data.', MARGIN, y + 6);
    y += 12;
  } else {
    const distRows = districts.map((d) => [
      `${d.customer_district || '—'}${d.customer_name ? ` · ${d.customer_name}` : ''}`,
      String(d.xc_caused_incidents ?? 0),
      d.stages_per_xc_incident != null
        ? Number(d.stages_per_xc_incident).toLocaleString('en-US', { maximumFractionDigits: 0 })
        : '—',
    ]);
    const distCols = [CONT_W * 0.55, CONT_W * 0.2, CONT_W * 0.25];
    y = drawTable(doc, ['District', 'XC-Caused', 'Stages / XC Inc.'], distRows, distCols, y) + 8;
  }

  drawFooters(doc);

  // ── Save via blob + manual anchor (doc.save() can silently fail) ─────────────
  const fileName = `Executive_Overview_${new Date().toISOString().slice(0, 10)}.pdf`;
  const blob: Blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
