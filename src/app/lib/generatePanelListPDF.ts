import {
  loadJsPDF, drawHeader, drawFooters, drawSectionHeading, drawTable,
  XC_GREEN, XC_DARK, XC_BORDER, WHITE, GRAY_TEXT, LIGHT_GREEN,
  MARGIN, CONT_W, PAGE_H, PAGE_W,
} from './pdfUtils';
import { getSerial } from './serialUtils';

export interface PanelRow {
  serial_number?: string;
  'serial#'?: string;
  panel_type: string;
  panel_status: string;
  xc_base: string;
  shootingfw?: string;
  wl_controlfw?: string;
  loggingfw?: string;
  surfacefw?: string;
  received_date?: string;
  customerName?: string;
  districtName?: string;
  comments?: string;
  verified?: string;
}

export interface PanelListOptions {
  panels: PanelRow[];
  customerName?: string;
  districtName?: string;
  logoUrl?: string | null;
}

const STATUS_COLORS: Record<string, [number, number, number]> = {
  'At Facility': [34, 197, 94],
  'Leased':      [37, 99, 235],
  'In Repair':   [245, 158, 11],
  'Loaned':      [168, 85, 247],
  'Sold':        [220, 38, 38],
  'Shipped':     [13, 148, 136],
};

export async function generatePanelListPDF(opts: PanelListOptions): Promise<void> {
  const { panels, customerName, districtName, logoUrl } = opts;
  const doc = await loadJsPDF();

  // ── Page 1 header ─────────────────────────────────────────────────────────
  let y = drawHeader(doc, new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }));
  y += 8;

  // ── Title block ───────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(...XC_DARK);
  doc.text('XFire Panel Inventory', MARGIN, y + 8);

  if (customerName) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...GRAY_TEXT);
    doc.text(`Customer: ${customerName}${districtName ? ` — ${districtName}` : ''}`, MARGIN, y + 15);
  } else {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...GRAY_TEXT);
    doc.text('All Customers — Complete Inventory', MARGIN, y + 15);
  }

  // Customer logo top-right
  if (logoUrl) {
    try { doc.addImage(logoUrl, 'PNG', PAGE_W - MARGIN - 30, y, 30, 18); } catch {}
  }

  y += 22;

  // ── Summary stats bar ─────────────────────────────────────────────────────
  doc.setFillColor(...LIGHT_GREEN);
  doc.setDrawColor(...XC_GREEN);
  doc.setLineWidth(0.5);
  doc.roundedRect(MARGIN, y, CONT_W, 14, 2, 2, 'FD');

  const statusCounts = panels.reduce((acc, p) => {
    const s = p.panel_status || 'Unknown';
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const statItems = [
    { label: 'Total Panels', value: String(panels.length) },
    ...Object.entries(statusCounts).map(([k, v]) => ({ label: k, value: String(v) })),
  ];

  const statW = CONT_W / Math.min(statItems.length, 6);
  statItems.slice(0, 6).forEach((item, i) => {
    const sx = MARGIN + i * statW;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...XC_GREEN);
    doc.text(item.value, sx + statW / 2, y + 7.5, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.5);
    doc.setTextColor(...GRAY_TEXT);
    doc.text(item.label.toUpperCase(), sx + statW / 2, y + 12, { align: 'center' });
  });

  y += 20;

  // ── Group panels by type ──────────────────────────────────────────────────
  const grouped: Record<string, PanelRow[]> = {};
  panels.forEach(p => {
    const type = p.panel_type || 'Other';
    if (!grouped[type]) grouped[type] = [];
    grouped[type].push(p);
  });

  const cols = [
    { header: 'Serial #',    width: 38 },
    { header: 'Status',      width: 28 },
    { header: 'XC Base',     width: 22 },
    { header: 'Shooting FW', width: 25 },
    { header: 'Received',    width: 26 },
    { header: 'Verified',    width: 20 },
    { header: 'Comments',    width: CONT_W - 38 - 28 - 22 - 25 - 26 - 20 },
  ];

  const headerH = 8;
  const rowH    = 7;

  const drawTableHeader = (dy: number) => {
    doc.setFillColor(...XC_DARK);
    doc.rect(MARGIN, dy, CONT_W, headerH, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(...WHITE);
    let hx = MARGIN;
    cols.forEach(col => { doc.text(col.header, hx + 2, dy + 5.5); hx += col.width; });
    return dy + headerH;
  };

  for (const [type, typePanels] of Object.entries(grouped)) {
    // Page break before section heading
    if (y + 40 > PAGE_H - 15) {
      doc.addPage();
      y = drawHeader(doc) + 15;
    }

    y = drawSectionHeading(doc, `${type} (${typePanels.length})`, y);
    y = drawTableHeader(y);

    typePanels.forEach((p, ri) => {
      // Page break mid-table
      if (y + rowH > PAGE_H - 15) {
        doc.addPage();
        y = drawHeader(doc) + 15;
        y = drawTableHeader(y);
      }

      const row = {
        serial:       getSerial(p),
        status:       p.panel_status || '—',
        base:         p.xc_base || '—',
        fw:           p.shootingfw || '—',
        received:     p.received_date || '—',
        verified:     p.verified === 'Y' ? 'Yes' : p.verified === 'N' ? 'No' : '—',
        comments:     p.comments || '',
        _statusColor: STATUS_COLORS[p.panel_status] || GRAY_TEXT,
      };

      doc.setFillColor(ri % 2 === 0 ? 255 : 248, ri % 2 === 0 ? 255 : 250, ri % 2 === 0 ? 255 : 252);
      doc.rect(MARGIN, y, CONT_W, rowH, 'F');
      doc.setFillColor(...XC_GREEN);
      doc.rect(MARGIN, y, 1.5, rowH, 'F');

      const values = [
        { text: row.serial,   color: XC_DARK,           bold: true  },
        { text: row.status,   color: row._statusColor,   bold: true  },
        { text: row.base,     color: XC_DARK,           bold: false },
        { text: row.fw,       color: GRAY_TEXT,          bold: false },
        { text: row.received, color: GRAY_TEXT,          bold: false },
        { text: row.verified, color: row.verified === 'Yes' ? XC_GREEN : GRAY_TEXT, bold: false },
        { text: row.comments, color: GRAY_TEXT,          bold: false },
      ];

      let rx = MARGIN + 1.5;
      values.forEach((v, ci) => {
        doc.setFont('helvetica', v.bold ? 'bold' : 'normal');
        doc.setFontSize(6.5);
        doc.setTextColor(...v.color);
        const maxLen = Math.floor(cols[ci].width / 1.7);
        const txt = v.text.length > maxLen ? v.text.slice(0, maxLen - 1) + '…' : v.text;
        doc.text(txt, rx + 2, y + 4.8);
        rx += cols[ci].width;
      });

      y += rowH;
    });

    doc.setDrawColor(...XC_BORDER);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, y, MARGIN + CONT_W, y);
    y += 10;
  }

  drawFooters(doc);

  const safe = (customerName || 'AllCustomers').replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_');
  const dist = districtName ? `_${districtName.replace(/[^a-zA-Z0-9]/g, '')}` : '';
  doc.save(`XFire_Panels_${safe}${dist}_${new Date().toISOString().slice(0, 10)}.pdf`);
}