/**
 * Pure helpers for the shared technical-bulletin report storage flow.
 *
 * Kept free of Supabase imports so they can be exercised by node tests
 * (the main `bulletinReportStorage` module pulls in `supabase.ts`, which
 * relies on `import.meta.env` and only works inside Vite).
 *
 * Mirrors incidentReportStorage.core so the two flows stay consistent.
 */

export const TECHNICAL_BULLETINS_BUCKET = 'technical-bulletins';

// 'Standard' (multi-page) or 'Compact' (one-page) — the two PDF variants the
// generator produces. One current stored row per (bulletin_id, report_type).
export type BulletinReportVariant = 'standard' | 'compact';

export type BulletinReportRow = {
  row_id: string;
  bulletin_id: string;
  report_type: string; // 'Standard' | 'Compact'
  file_path?: string | null;
  file_name: string | null;
  generated_at: string | null;
  generated_by: string | null;
};

export const reportTypeFor = (v: BulletinReportVariant) =>
  v === 'compact' ? 'Compact' : 'Standard';

export const sanitizeId = (id: string) =>
  String(id).replace(/[^A-Za-z0-9_-]/g, '_');

/**
 * Convenience: find the current Standard or Compact row in a list of reports.
 */
export function pickBulletinReport(
  reports: BulletinReportRow[] | undefined,
  variant: BulletinReportVariant,
): BulletinReportRow | undefined {
  if (!reports) return undefined;
  const target = reportTypeFor(variant);
  return reports.find(r => r.report_type === target);
}
