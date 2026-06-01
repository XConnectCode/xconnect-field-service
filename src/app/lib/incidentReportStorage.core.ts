/**
 * Pure helpers for the shared incident-report storage flow.
 *
 * Kept free of Supabase imports so they can be exercised by node tests
 * (the main `incidentReportStorage` module pulls in `supabase.ts`, which
 * relies on `import.meta.env` and only works inside Vite).
 */

export const INCIDENT_REPORTS_BUCKET = 'incident-reports';

// Sentinel scheme written into the legacy `file_url` NOT NULL column when
// a report is stored in the Supabase Storage bucket. `file_path` remains
// the canonical pointer; this marker keeps the legacy column populated so
// inserts don't violate the NOT NULL constraint and AppSheet/public links
// (real `http(s)://...` URLs in `file_url`) still work for older rows.
export const STORAGE_URL_SCHEME = 'storage://';

export const buildStorageMarker = (path: string) =>
  `${STORAGE_URL_SCHEME}${INCIDENT_REPORTS_BUCKET}/${path}`;

export const isStorageMarker = (url: string | null | undefined) =>
  typeof url === 'string' && url.startsWith(STORAGE_URL_SCHEME);

export type IncidentReportVersion = 'preliminary' | 'final';

export type IncidentReportRow = {
  row_id: string;
  event_id: string;
  report_type: string;
  report_version?: string | null;
  file_url: string | null;
  file_path?: string | null;
  file_name: string | null;
  generated_at: string | null;
  generated_by: string | null;
};

export const reportTypeFor = (v: IncidentReportVersion) =>
  v === 'preliminary' ? 'Preliminary' : 'Final';

export const sanitizeEventId = (eventId: string) =>
  String(eventId).replace(/[^A-Za-z0-9_-]/g, '_');

/**
 * report_type written for native AppSheet reports migrated from Drive.
 * These are treated as the "Final" report so they surface in the main
 * Final slot, while ALSO continuing to appear in the Archive list
 * (the archive filter only excludes 'Preliminary'/'Final').
 */
export const APPSHEET_ORIGINAL_TYPE = 'AppSheet Original';

/**
 * Convenience: find the current Preliminary or Final row in a list of reports.
 *
 * Fallback: when asking for the Final report and no app-generated Final
 * exists, surface a migrated native 'AppSheet Original' report instead so
 * incidents that already had a report attached in AppSheet show it in the
 * main Final slot (it also remains visible in the Archive section).
 */
export function pickReport(
  reports: IncidentReportRow[] | undefined,
  version: IncidentReportVersion,
): IncidentReportRow | undefined {
  if (!reports) return undefined;
  const target = reportTypeFor(version);
  const exact = reports.find(r => r.report_type === target);
  if (exact) return exact;
  if (version === 'final') {
    return reports.find(r => r.report_type === APPSHEET_ORIGINAL_TYPE);
  }
  return undefined;
}
