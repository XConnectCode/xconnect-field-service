import {
  loadJsPDF, drawHeader, drawFooters, drawSectionHeading, drawTable,
  XC_DARK, GRAY_TEXT,
  MARGIN, CONT_W, PAGE_H, PAGE_W,
} from './pdfUtils';
import { getSerial } from './serialUtils';

export interface RepairFailureReportOptions {
  manufacturer: string;
  rma?: string;
  shipDate?: string;
  trackingInfo?: string;
  panel: {
    serial_number?: string;
    'serial#'?: string;
    serial?: string;
    panel_type?: string;
    unit_number?: string;
    panel_status?: string;
    xc_base?: string;
    shootingfw?: string;
    wl_controlfw?: string;
    loggingfw?: string;
    surfacefw?: string;
    gui_version?: string;
    received_date?: string;
  };
  failureDescription?: string;
  failureDate?: string;
  reportedBy?: string;
  logoUrl?: string | null;
}

const dash = (v?: string | null): string => (v && String(v).trim() ? String(v) : '—');

export async function generateRepairFailureReportPDF(opts: RepairFailureReportOptions): Promise<void> {
  const { manufacturer, rma, shipDate, trackingInfo, panel, failureDescription, failureDate, reportedBy, logoUrl } = opts;
  const doc = await loadJsPDF();
  const serial = getSerial(panel) || panel.serial_number || '';

  // ── Page 1 header ──
  const subtitle = `${manufacturer || 'Manufacturer'}${rma ? ` · RMA ${rma}` : ''}`;
  let y = drawHeader(doc, subtitle);
  y += 8;

  // ── Title block ──
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(...XC_DARK);
  doc.text('Panel Repair / Failure Report', MARGIN, y + 8);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...GRAY_TEXT);
  doc.text(
    `Generated ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`,
    MARGIN, y + 15,
  );

  if (logoUrl) {
    try { doc.addImage(logoUrl, 'PNG', PAGE_W - MARGIN - 30, y, 30, 18); } catch {}
  }

  y += 16;

  const kv = (label: string, value?: string | null): string[] => [label, dash(value)];
  const COL_W = [CONT_W * 0.4, CONT_W * 0.6];

  // ── Panel Information ──
  y = drawSectionHeading(doc, 'Panel Information', y);
  y = drawTable(doc, ['Field', 'Value'], [
    kv('Serial #', serial),
    kv('Panel Type', panel.panel_type),
    kv('Unit #', panel.unit_number),
    kv('Status', panel.panel_status),
    kv('XC Base', panel.xc_base),
    kv('Received Date', panel.received_date),
  ], COL_W, y);
  y += 5;

  // ── Firmware Versions ──
  y = drawSectionHeading(doc, 'Firmware Versions', y);
  y = drawTable(doc, ['Field', 'Value'], [
    kv('Shooting FW', panel.shootingfw),
    kv('WL Control FW', panel.wl_controlfw),
    kv('Logging FW', panel.loggingfw),
    kv('Surface FW', panel.surfacefw),
    kv('GUI Version', panel.gui_version),
  ], COL_W, y);
  y += 5;

  // ── Failure Details ──
  y = drawSectionHeading(doc, 'Failure Details', y);
  y = drawTable(doc, ['Field', 'Value'], [
    kv('Reported By', reportedBy),
    kv('Failure Date', failureDate),
  ], COL_W, y);
  y += 3;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...GRAY_TEXT);
  doc.text('DESCRIPTION', MARGIN, y + 4);
  y += 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(...XC_DARK);
  const DESC_STEP = 4.2;
  const descLines: string[] = doc.splitTextToSize(failureDescription || '—', CONT_W);
  const maxDescLines = Math.max(0, Math.floor((PAGE_H - 15 - y - 40) / DESC_STEP));
  let renderLines = descLines;
  if (descLines.length > maxDescLines) {
    renderLines = descLines.slice(0, Math.max(0, maxDescLines - 1));
    renderLines.push((descLines[Math.max(0, maxDescLines - 1)] || '').replace(/\s*$/, '') + ' …');
  }
  renderLines.forEach((line: string) => {
    doc.text(line, MARGIN, y);
    y += DESC_STEP;
  });
  y += 4;

  // ── Return Shipment ──
  y = drawSectionHeading(doc, 'Return Shipment', y);
  y = drawTable(doc, ['Field', 'Value'], [
    kv('Manufacturer', manufacturer),
    kv('RMA #', rma),
    kv('Ship Date', shipDate),
    kv('Tracking #', trackingInfo),
  ], COL_W, y);

  drawFooters(doc);

  const safeSerial = (serial || 'panel').replace(/[^a-zA-Z0-9]/g, '');
  doc.save(`Repair-Failure-Report_${safeSerial}_${new Date().toISOString().slice(0, 10)}.pdf`);
}
