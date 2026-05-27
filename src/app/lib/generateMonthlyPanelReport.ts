import {
  loadJsPDF, drawHeader, drawFooters, drawWatermark,
  XC_GREEN, XC_DARK, XC_BORDER, WHITE, GRAY_TEXT, XC_GRAY,
  MARGIN, CONT_W, PAGE_H, PAGE_W,
} from './pdfUtils';

export interface MonthlyPanelReportOptions {
  panels: any[];
  customerName: string;
  districtName?: string;
  reportMonth: string;
  preparedBy?: string;
}

const LEASE_RATES: Record<string, { label: string; monthly: number; replace: number }> = {
  'P1000':                  { label: 'XC XFire Communication Panel – P1000',  monthly: 100,  replace: 6000  },
  'P2000':                  { label: 'XC XFire Communication Panel – P2000',  monthly: 200,  replace: 10000 },
  'P2500':                  { label: 'XC XFire Communication Panel – P2500',  monthly: 250,  replace: 14500 },
  'Digital Shooting Panel': { label: 'XFire Digital Shooting Panel',          monthly: 100,  replace: 11500 },
  'Master Safe Panel':      { label: 'XFire Master Safe Panel',               monthly: 50,   replace: 2000  },
  'Toolstring Verifier':    { label: 'XFire Toolstring Verifier',             monthly: 75,   replace: 3500  },
  'Pressure Box':           { label: 'XFire Surface Test Box',                monthly: 50,   replace: 7000  },
};

function fmt$(n: number) {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
}

const getSerial = (p: any) => p?.['serial#'] || p?.serial_number || p?.serial || '—';

function sectionHead(doc: any, text: string, y: number): number {
  doc.setFillColor(...XC_DARK as [number, number, number]);
  doc.rect(MARGIN, y, CONT_W, 9, 'F');
  doc.setFillColor(...XC_GREEN as [number, number, number]);
  doc.rect(MARGIN, y, 3, 9, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...WHITE as [number, number, number]);
  doc.text(text.toUpperCase(), MARGIN + 7, y + 6.2);
  return y + 14;
}

function tocLine(doc: any, label: string, page: number, y: number) {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...GRAY_TEXT as [number, number, number]);
  const labelW = doc.getTextWidth(label);
  const dots = '· '.repeat(60);
  doc.text(label, MARGIN + 2, y);
  doc.setTextColor(200, 200, 200);
  doc.text(dots, MARGIN + 2 + labelW + 1, y, { maxWidth: CONT_W - labelW - 14 });
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...XC_GREEN as [number, number, number]);
  doc.text(String(page), PAGE_W - MARGIN, y, { align: 'right' });
}

export async function generateMonthlyPanelReport(opts: MonthlyPanelReportOptions): Promise<void> {
  const { panels, customerName, districtName, reportMonth, preparedBy } = opts;
  const doc = await loadJsPDF();

  const leasedPanels   = panels.filter(p => p.verified === 'Y' && p.panel_status === 'Leased');
  const verifiedPanels = panels.filter(p => p.verified === 'Y');

  // ── PAGE 1: COVER ──────────────────────────────────────────────────────────
  const headerH = drawHeader(doc);
  drawWatermark(doc);

  // Title placed BELOW the header image on white background
  let y = headerH + 18;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(28);
  doc.setTextColor(...XC_DARK as [number, number, number]);
  doc.text('Monthly Panel Report', PAGE_W / 2, y, { align: 'center' });
  y += 10;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(13);
  doc.setTextColor(...GRAY_TEXT as [number, number, number]);
  doc.text('XConnect, LLC', PAGE_W / 2, y, { align: 'center' });

  y += 8;
  doc.setFillColor(...XC_GREEN as [number, number, number]);
  doc.rect(PAGE_W / 2 - 20, y, 40, 1.5, 'F');

  y += 20;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...XC_DARK as [number, number, number]);
  doc.text(customerName, MARGIN, y);
  y += 10;
  if (districtName) {
    doc.setFontSize(14);
    doc.setTextColor(...GRAY_TEXT as [number, number, number]);
    doc.text(districtName, MARGIN, y);
    y += 9;
  }
  doc.setFontSize(13);
  doc.setTextColor(...XC_DARK as [number, number, number]);
  doc.text(reportMonth, MARGIN, y);

  if (preparedBy) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...GRAY_TEXT as [number, number, number]);
    doc.text('Prepared By:', MARGIN, PAGE_H - 30);
    doc.setFillColor(240, 240, 240);
    doc.setDrawColor(...XC_BORDER as [number, number, number]);
    doc.roundedRect(MARGIN, PAGE_H - 26, 55, 9, 1, 1, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...XC_DARK as [number, number, number]);
    doc.text(preparedBy, MARGIN + 4, PAGE_H - 20);
  }

  // ── PAGE 2: TABLE OF CONTENTS ──────────────────────────────────────────────
  doc.addPage();
  const hh2 = drawHeader(doc);
  drawWatermark(doc);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(28);
  doc.setTextColor(...XC_GREEN as [number, number, number]);
  doc.text('X', MARGIN, hh2 + 22);
  doc.setTextColor(...XC_DARK as [number, number, number]);
  doc.setFontSize(18);
  doc.text('ONNECT', MARGIN + 13, hh2 + 22);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('Table Of Contents:', MARGIN, hh2 + 35);

  y = hh2 + 52;
  const tocItems = [
    { label: 'REPORT INTRODUCTION & MONTHLY LEASE SUMMARY', page: 3 },
    { label: 'LEASED PANEL LEDGER',                          page: 4 },
    { label: 'REPLACEMENT/PURCHASE COSTS',                  page: 5 },
    { label: 'REVISION STATEMENT, TERMS & CONDITIONS',       page: 6 },
  ];
  tocItems.forEach(item => {
    tocLine(doc, item.label, item.page, y);
    y += 12;
  });

  // ── PAGE 3: INTRO + LEASE SUMMARY ─────────────────────────────────────────
  doc.addPage();
  const hh3 = drawHeader(doc);
  drawWatermark(doc);
  y = hh3 + 8;

  y = sectionHead(doc, 'Report Introduction', y);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(50, 50, 50);
  const intro = `Please find below the current list of XFire panels provided to ${customerName}, along with a breakdown of monthly lease charges associated with each panel type. This document is intended to provide a clear summary of your active leased units and their corresponding costs. Please note that any damaged or missing equipment will be subject to repair or replacement costs as outlined in the attached Equipment Cost Summary.`;
  const introLines = doc.splitTextToSize(intro, CONT_W - 4);
  doc.text(introLines, MARGIN + 2, y);
  y += introLines.length * 5.5 + 12;

  y = sectionHead(doc, 'Monthly Lease Summary', y);

  const cols = { type: 100, qty: 20, rate: 32, total: CONT_W - 100 - 20 - 32 };
  doc.setFillColor(...XC_GREEN as [number, number, number]);
  doc.rect(MARGIN, y, CONT_W, 8, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...WHITE as [number, number, number]);
  doc.text('PANEL TYPE',  MARGIN + 2,                                    y + 5.5);
  doc.text('QTY',         MARGIN + cols.type + 2,                        y + 5.5);
  doc.text('MONTHLY',     MARGIN + cols.type + cols.qty + 2,             y + 5.5);
  doc.text('TOTAL',       MARGIN + cols.type + cols.qty + cols.rate + 2, y + 5.5);
  y += 8;

  const leaseCounts: Record<string, number> = {};
  leasedPanels.forEach(p => {
    const t = p.panel_type || 'Other';
    leaseCounts[t] = (leaseCounts[t] || 0) + 1;
  });

  let grandTotal = 0;
  const allTypes = [...new Set([...Object.keys(LEASE_RATES), ...Object.keys(leaseCounts)])];

  allTypes.forEach((type, idx) => {
    const rate = LEASE_RATES[type];
    if (!rate) return;
    const qty   = leaseCounts[type] || 0;
    const total = qty * rate.monthly;
    grandTotal += total;

    doc.setFillColor(idx % 2 === 0 ? 255 : 248, idx % 2 === 0 ? 255 : 249, idx % 2 === 0 ? 255 : 248);
    doc.rect(MARGIN, y, CONT_W, 9, 'F');
    doc.setDrawColor(...XC_BORDER as [number, number, number]);
    doc.setLineWidth(0.2);
    doc.line(MARGIN, y + 9, MARGIN + CONT_W, y + 9);

    doc.setFont('helvetica', qty > 0 ? 'bold' : 'normal');
    doc.setFontSize(9);
    doc.setTextColor(qty > 0 ? XC_DARK[0] : 140, qty > 0 ? XC_DARK[1] : 140, qty > 0 ? XC_DARK[2] : 140);
    doc.text(rate.label, MARGIN + 2, y + 6);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(qty > 0 ? XC_GREEN[0] : 140, qty > 0 ? XC_GREEN[1] : 140, qty > 0 ? XC_GREEN[2] : 140);
    doc.text(String(qty), MARGIN + cols.type + 6, y + 6);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...GRAY_TEXT as [number, number, number]);
    doc.text(fmt$(rate.monthly), MARGIN + cols.type + cols.qty + 2, y + 6);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...XC_DARK as [number, number, number]);
    doc.text(fmt$(total), MARGIN + cols.type + cols.qty + cols.rate + 2, y + 6);
    y += 9;
  });

  doc.setFillColor(...XC_DARK as [number, number, number]);
  doc.rect(MARGIN, y, CONT_W, 9, 'F');
  doc.setFillColor(...XC_GREEN as [number, number, number]);
  doc.rect(MARGIN, y, 3, 9, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(...WHITE as [number, number, number]);
  doc.text('MONTHLY TOTAL', MARGIN + 7, y + 6);
  doc.text(fmt$(grandTotal), MARGIN + cols.type + cols.qty + cols.rate + 2, y + 6);

  // ── PAGE 4: PANEL LEDGER ───────────────────────────────────────────────────
  doc.addPage();
  const hh4 = drawHeader(doc);
  drawWatermark(doc);
  y = hh4 + 8;

  y = sectionHead(doc, 'Leased Panel Ledger', y);

  const ledgerCols = { type: 70, serial: 55, unit: 30, fw: 27, status: CONT_W - 70 - 55 - 30 - 27 };

  const drawLedgerHeader = (dy: number) => {
    doc.setFillColor(...XC_GREEN as [number, number, number]);
    doc.rect(MARGIN, dy, CONT_W, 8, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...WHITE as [number, number, number]);
    doc.text('PANEL TYPE',  MARGIN + 2,                                                                      dy + 5.5);
    doc.text('SERIAL #',    MARGIN + ledgerCols.type + 2,                                                    dy + 5.5);
    doc.text('UNIT #',      MARGIN + ledgerCols.type + ledgerCols.serial + 2,                                dy + 5.5);
    doc.text('FW VERSION',  MARGIN + ledgerCols.type + ledgerCols.serial + ledgerCols.unit + 2,              dy + 5.5);
    doc.text('STATUS',      MARGIN + ledgerCols.type + ledgerCols.serial + ledgerCols.unit + ledgerCols.fw + 2, dy + 5.5);
    return dy + 8;
  };

  y = drawLedgerHeader(y);

  const STATUS_COLORS: Record<string, [number, number, number]> = {
    'Leased':      [37, 99, 235],
    'At Facility': [34, 197, 94],
    'In Repair':   [245, 158, 11],
    'Loaned':      [168, 85, 247],
    'Sold':        [220, 38, 38],
  };

  const grouped: Record<string, any[]> = {};
  verifiedPanels.forEach(p => {
    const t = p.panel_type || 'Other';
    if (!grouped[t]) grouped[t] = [];
    grouped[t].push(p);
  });

  let rowIdx = 0;
  for (const [type, typePanels] of Object.entries(grouped)) {
    for (const p of typePanels) {
      if (y + 8 > PAGE_H - 15) {
        doc.addPage();
        const hhn = drawHeader(doc);
        y = drawLedgerHeader(hhn + 15);
        rowIdx = 0;
      }

      doc.setFillColor(rowIdx % 2 === 0 ? 255 : 248, rowIdx % 2 === 0 ? 255 : 249, rowIdx % 2 === 0 ? 255 : 248);
      doc.rect(MARGIN, y, CONT_W, 7.5, 'F');
      doc.setDrawColor(...XC_BORDER as [number, number, number]);
      doc.setLineWidth(0.15);
      doc.line(MARGIN, y + 7.5, MARGIN + CONT_W, y + 7.5);

      const isFirst = typePanels.indexOf(p) === 0;
      if (isFirst) {
        doc.setFillColor(...XC_GREEN as [number, number, number]);
        doc.rect(MARGIN, y, 1.5, 7.5, 'F');
      }

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(...XC_DARK as [number, number, number]);
      doc.text(type, MARGIN + (isFirst ? 3.5 : 2), y + 5);

      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...GRAY_TEXT as [number, number, number]);
      doc.text(getSerial(p), MARGIN + ledgerCols.type + 2,                                       y + 5);
      doc.text(p['unit#']   || '—', MARGIN + ledgerCols.type + ledgerCols.serial + 2,                   y + 5);
      doc.text(p.shootingfw || '—', MARGIN + ledgerCols.type + ledgerCols.serial + ledgerCols.unit + 2, y + 5);

      const sc = STATUS_COLORS[p.panel_status] || (GRAY_TEXT as [number, number, number]);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...sc);
      doc.text(p.panel_status || '—', MARGIN + ledgerCols.type + ledgerCols.serial + ledgerCols.unit + ledgerCols.fw + 2, y + 5);

      y += 7.5;
      rowIdx++;
    }
  }

  y += 2;
  doc.setFillColor(...XC_DARK as [number, number, number]);
  doc.rect(MARGIN, y, CONT_W, 8, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...WHITE as [number, number, number]);
  doc.text(`TOTAL VERIFIED PANELS: ${verifiedPanels.length}`, MARGIN + 7, y + 5.5);
  if (leasedPanels.length !== verifiedPanels.length) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(180, 220, 160);
    doc.text(`(${leasedPanels.length} Leased)`, MARGIN + 80, y + 5.5);
  }

  // ── PAGE 5: REPLACEMENT COSTS ──────────────────────────────────────────────
  doc.addPage();
  const hh5 = drawHeader(doc);
  drawWatermark(doc);
  y = hh5 + 8;

  y = sectionHead(doc, 'Replacement / Purchase Costs', y);
  y += 4;

  const costSections = [
    {
      label: 'Communication Panels',
      items: [
        { name: 'P1000',  price: 6000  },
        { name: 'P2000',  price: 10000 },
        { name: 'P2500',  price: 14500 },
        { name: 'P2500+', price: 18500 },
      ],
    },
    {
      label: 'Supporting Panels',
      items: [
        { name: 'Digital Shooting Panel', price: 11500 },
        { name: 'XFire Test Box',         price: 7000  },
        { name: 'Master Safe Panel',      price: 2000  },
        { name: 'Toolstring Verifier',    price: 3500  },
      ],
    },
    {
      label: 'Accessories / Cables',
      items: [
        { name: 'Test Leads',                       price: 175 },
        { name: 'Test Box Power Supply',             price: 50  },
        { name: 'Wireline / Shooting Cable',         price: 175 },
        { name: 'Panel Acquisition / Warrior Cable', price: 250 },
      ],
    },
  ];

  const halfW = (CONT_W - 6) / 2;
  let col = 0;
  const colY = [y, y];

  costSections.forEach(section => {
    const cx = MARGIN + col * (halfW + 6);
    let cy = colY[col];

    doc.setFillColor(...XC_GREEN as [number, number, number]);
    doc.rect(cx, cy, halfW, 0.8, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...XC_DARK as [number, number, number]);
    doc.text(section.label.toUpperCase(), cx, cy + 6);
    cy += 9;

    section.items.forEach((item, idx) => {
      doc.setFillColor(idx % 2 === 0 ? 252 : 246, idx % 2 === 0 ? 252 : 248, idx % 2 === 0 ? 252 : 246);
      doc.rect(cx, cy, halfW, 8, 'F');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(60, 60, 60);
      doc.text(item.name, cx + 2, cy + 5.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...XC_GREEN as [number, number, number]);
      doc.text(fmt$(item.price), cx + halfW - 2, cy + 5.5, { align: 'right' });
      cy += 8;
    });

    colY[col] = cy + 8;
    col = col === 0 ? 1 : 0;
  });

  // ── PAGE 6: REVISION + T&C ─────────────────────────────────────────────────
  doc.addPage();
  const hh6 = drawHeader(doc);
  drawWatermark(doc);
  y = hh6 + 8;

  y = sectionHead(doc, 'Revision Statement', y);
  y += 4;

  const revText = `Please notify XConnect, LLC by writing within 10 business days from the date of this report if this list is not correct. If no objections or corrections are made within this period, the listed items will be considered accurate, and The Customer assumes full responsibility for the equipment under the terms of this agreement.`;
  const revLines = doc.splitTextToSize(revText, CONT_W - 4);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(50, 50, 50);
  doc.text(revLines, MARGIN + 2, y);
  y += revLines.length * 5.5 + 14;

  y = sectionHead(doc, 'Terms & Conditions', y);
  y += 6;

  const terms = [
    'Rented/loaned equipment remains the property of XConnect, LLC.',
    'Equipment must be returned in working order within 30 days of the last completed order with XConnect, LLC.',
    'Failure to return the equipment in good condition within this 30-day period will result in The Customer being charged the full replacement cost.',
    'The Customer is responsible for any damage, loss, or theft occurring while the equipment is in their possession.',
  ];

  terms.forEach(term => {
    const termLines = doc.splitTextToSize(term, CONT_W - 12);
    const boxH = (termLines.length * 5.2) + 7;
    doc.setFillColor(250, 252, 250);
    doc.setDrawColor(...XC_BORDER as [number, number, number]);
    doc.setLineWidth(0.3);
    doc.roundedRect(MARGIN, y, CONT_W, boxH, 1, 1, 'FD');
    doc.setFillColor(...XC_GREEN as [number, number, number]);
    doc.rect(MARGIN, y, 2, boxH, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(50, 50, 50);
    doc.text(termLines, MARGIN + 6, y + 5.5);
    y += boxH + 5;
  });

  y += 10;
  doc.setDrawColor(...XC_BORDER as [number, number, number]);
  doc.setLineWidth(0.5);
  doc.line(MARGIN, y, MARGIN + 70, y);
  doc.line(MARGIN + 100, y, MARGIN + 170, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...GRAY_TEXT as [number, number, number]);
  doc.text('XConnect Representative', MARGIN, y + 5);
  doc.text('Customer Representative', MARGIN + 100, y + 5);
  doc.text(new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }), MARGIN, y + 11);

  drawFooters(doc);

  const safe  = customerName.replace(/[^a-zA-Z0-9]/g, '_');
  const dist  = districtName ? `_${districtName.replace(/[^a-zA-Z0-9]/g, '')}` : '';
  const month = reportMonth.replace(/\s+/g, '_');
  doc.save(`XC_Monthly_Panel_Report_${safe}${dist}_${month}.pdf`);
}