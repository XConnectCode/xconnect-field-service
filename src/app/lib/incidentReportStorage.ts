/**
 * Shared Supabase Storage flow for incident PDF reports.
 *
 * Reports are uploaded to the `incident-reports` bucket (private) and
 * tracked in the `incident_reports` table so every authenticated user
 * sees the same reports across devices.
 *
 * Bucket setup is documented in
 *   database-migrations/incident_reports_storage.sql
 */
import { supabase } from './supabase';
import {
  INCIDENT_REPORTS_BUCKET,
  buildStorageMarker,
  isStorageMarker,
  reportTypeFor,
  sanitizeEventId,
  type IncidentReportRow,
  type IncidentReportVersion,
} from './incidentReportStorage.core';

export {
  INCIDENT_REPORTS_BUCKET,
  STORAGE_URL_SCHEME,
  buildStorageMarker,
  isStorageMarker,
  pickReport,
} from './incidentReportStorage.core';
export type {
  IncidentReportRow,
  IncidentReportVersion,
} from './incidentReportStorage.core';

const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour

/**
 * Upload a generated PDF to Supabase Storage and record it in
 * the incident_reports table. Replaces any prior report row of the
 * same type for this event_id (one current per type).
 */
export async function uploadIncidentReport(params: {
  blob: Blob;
  eventId: string;
  version: IncidentReportVersion;
  generatedBy?: string | null;
}): Promise<IncidentReportRow> {
  const { blob, eventId, version, generatedBy } = params;
  if (!eventId) throw new Error('eventId is required to upload a report');

  // Saving a report to shared storage requires a real authenticated
  // Supabase session (RLS gates the bucket on auth.role() = 'authenticated').
  // The local dev "default-admin" auto-login is NOT a real session, so guard
  // here with a clear message instead of a cryptic RLS rejection.
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    throw new Error(
      'You must sign in with a real account (email/password or Google) to save reports. ' +
      'The demo auto-login cannot upload to shared storage.'
    );
  }

  const reportType = reportTypeFor(version);
  const safeEventId = sanitizeEventId(eventId);
  // Naming convention: Event_{EventID}_Final / Event_{EventID}_Preliminary.
  const fileName = `Event_${safeEventId}_${reportType}.pdf`;
  const path = `${safeEventId}/${version}-${Date.now()}.pdf`;

  const { error: uploadErr } = await supabase
    .storage
    .from(INCIDENT_REPORTS_BUCKET)
    .upload(path, blob, {
      contentType: 'application/pdf',
      cacheControl: '3600',
      upsert: true,
    });
  if (uploadErr) {
    throw new Error(`Storage upload failed: ${uploadErr.message}`);
  }

  // Replace any existing rows of this type for this event_id so each
  // (event_id, report_type) pair has a single current entry.
  const { data: existing } = await supabase
    .from('incident_reports')
    .select('row_id, file_path')
    .eq('event_id', String(eventId))
    .eq('report_type', reportType);

  if (existing && existing.length > 0) {
    const stalePaths = existing
      .map((r: any) => r.file_path)
      .filter((p: any): p is string => typeof p === 'string' && p && p !== path);
    if (stalePaths.length > 0) {
      // Best-effort cleanup; ignore failures (RLS, missing files, etc.)
      await supabase.storage.from(INCIDENT_REPORTS_BUCKET).remove(stalePaths).catch(() => {});
    }
    await supabase
      .from('incident_reports')
      .delete()
      .eq('event_id', String(eventId))
      .eq('report_type', reportType);
  }

  const payload = {
    event_id: String(eventId),
    report_type: reportType,
    file_path: path,
    // `file_url` is NOT NULL in the existing schema; populate it with an
    // internal sentinel so storage-backed rows satisfy the constraint
    // without colliding with real public URLs (which start with http(s)://).
    file_url: buildStorageMarker(path),
    file_name: fileName,
    generated_by: generatedBy || null,
    generated_at: new Date().toISOString(),
  };

  const { data: inserted, error: insertErr } = await supabase
    .from('incident_reports')
    .insert(payload)
    .select('*')
    .single();
  if (insertErr) {
    // Some older schemas may not have file_path yet; retry without it so
    // the feature still works once the bucket exists.
    if (/file_path/i.test(insertErr.message)) {
      const { data: retry, error: retryErr } = await supabase
        .from('incident_reports')
        .insert({ ...payload, file_path: undefined })
        .select('*')
        .single();
      if (retryErr) throw new Error(`incident_reports insert failed: ${retryErr.message}`);
      return retry as IncidentReportRow;
    }
    throw new Error(`incident_reports insert failed: ${insertErr.message}`);
  }
  return inserted as IncidentReportRow;
}

/**
 * Resolve a previewable/downloadable URL for a stored report.
 * - If file_path is present, mint a short-lived signed URL.
 * - Otherwise fall back to file_url for legacy AppSheet originals whose
 *   public URLs were imported directly. Sentinel `storage://...` markers
 *   are not valid URLs and are skipped.
 */
export async function getIncidentReportUrl(
  report: Pick<IncidentReportRow, 'file_path' | 'file_url'>,
): Promise<string> {
  if (report.file_path) {
    const { data, error } = await supabase
      .storage
      .from(INCIDENT_REPORTS_BUCKET)
      .createSignedUrl(report.file_path, SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) {
      throw new Error(`Could not get signed URL: ${error?.message || 'unknown error'}`);
    }
    return data.signedUrl;
  }
  if (report.file_url && !isStorageMarker(report.file_url)) return report.file_url;
  throw new Error('Report has no file_path or file_url');
}

/**
 * Load every report row for a given event_id, newest first.
 */
export async function listIncidentReports(eventId: string): Promise<IncidentReportRow[]> {
  if (!eventId) return [];
  const { data, error } = await supabase
    .from('incident_reports')
    .select('*')
    .eq('event_id', String(eventId))
    .order('generated_at', { ascending: false });
  if (error) {
    console.error('listIncidentReports error:', error);
    return [];
  }
  return (data || []) as IncidentReportRow[];
}

/**
 * Load reports for many incidents in a single query and group by event_id.
 * Used for list views that need to show "has report" badges.
 */
export async function listIncidentReportsForEvents(
  eventIds: string[],
): Promise<Record<string, IncidentReportRow[]>> {
  const ids = [...new Set(eventIds.filter(Boolean).map(String))];
  if (ids.length === 0) return {};
  const { data, error } = await supabase
    .from('incident_reports')
    .select('*')
    .in('event_id', ids);
  if (error) {
    console.error('listIncidentReportsForEvents error:', error);
    return {};
  }
  const out: Record<string, IncidentReportRow[]> = {};
  for (const row of (data || []) as IncidentReportRow[]) {
    const k = String(row.event_id);
    (out[k] ||= []).push(row);
  }
  return out;
}
