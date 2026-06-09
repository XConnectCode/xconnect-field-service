/**
 * Shared Supabase Storage flow for technical-bulletin PDF reports.
 *
 * Generated bulletin PDFs (Standard / Compact) are uploaded to the private
 * `technical-bulletins` bucket and tracked in the
 * `technical_bulletin_reports` table so every authenticated user can grab
 * the already-generated document straight from the saved bulletin entry —
 * mirroring how incidents store their reports.
 *
 * Bucket + table setup is documented in
 *   database-migrations/technical_bulletin_reports_storage.sql
 */
import { supabase } from './supabase';
import {
  TECHNICAL_BULLETINS_BUCKET,
  reportTypeFor,
  sanitizeId,
  type BulletinReportRow,
  type BulletinReportVariant,
} from './bulletinReportStorage.core';

export {
  TECHNICAL_BULLETINS_BUCKET,
  reportTypeFor,
  pickBulletinReport,
} from './bulletinReportStorage.core';
export type {
  BulletinReportRow,
  BulletinReportVariant,
} from './bulletinReportStorage.core';

const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour

/**
 * Upload a generated PDF to Supabase Storage and record it in the
 * technical_bulletin_reports table. Replaces any prior report row of the
 * same type for this bulletin_id (one current per type).
 */
export async function uploadBulletinReport(params: {
  blob: Blob;
  bulletinId: string;
  bulletinNumber: string;
  variant: BulletinReportVariant;
  generatedBy?: string | null;
}): Promise<BulletinReportRow> {
  const { blob, bulletinId, bulletinNumber, variant, generatedBy } = params;
  if (!bulletinId) throw new Error('bulletinId is required to upload a report');

  // Saving to shared storage requires a real authenticated Supabase session
  // (RLS gates the bucket on auth.role() = 'authenticated'). The local dev
  // "default-admin" auto-login is NOT a real session, so guard here with a
  // clear message instead of a cryptic RLS rejection.
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    throw new Error(
      'You must sign in with a real account (email/password or Google) to save documents. ' +
      'The demo auto-login cannot upload to shared storage.'
    );
  }

  const reportType = reportTypeFor(variant);
  const safeId = sanitizeId(bulletinId);
  const numForName = sanitizeId(bulletinNumber || bulletinId);
  // Naming convention: Technical_Bulletin_TB-{n}_{Standard|Compact}.pdf
  const fileName = `Technical_Bulletin_TB-${numForName}_${reportType}.pdf`;
  const path = `${safeId}/${variant}-${Date.now()}.pdf`;

  const { error: uploadErr } = await supabase
    .storage
    .from(TECHNICAL_BULLETINS_BUCKET)
    .upload(path, blob, {
      contentType: 'application/pdf',
      cacheControl: '3600',
      upsert: true,
    });
  if (uploadErr) {
    throw new Error(`Storage upload failed: ${uploadErr.message}`);
  }

  // Replace any existing rows of this type for this bulletin so each
  // (bulletin_id, report_type) pair has a single current entry.
  const { data: existing } = await supabase
    .from('technical_bulletin_reports')
    .select('row_id, file_path')
    .eq('bulletin_id', String(bulletinId))
    .eq('report_type', reportType);

  if (existing && existing.length > 0) {
    const stalePaths = existing
      .map((r: any) => r.file_path)
      .filter((p: any): p is string => typeof p === 'string' && p && p !== path);
    if (stalePaths.length > 0) {
      // Best-effort cleanup; ignore failures (RLS, missing files, etc.)
      await supabase.storage.from(TECHNICAL_BULLETINS_BUCKET).remove(stalePaths).catch(() => {});
    }
    await supabase
      .from('technical_bulletin_reports')
      .delete()
      .eq('bulletin_id', String(bulletinId))
      .eq('report_type', reportType);
  }

  const payload = {
    bulletin_id: String(bulletinId),
    report_type: reportType,
    file_path: path,
    file_name: fileName,
    generated_by: generatedBy || null,
    generated_at: new Date().toISOString(),
  };

  const { data: inserted, error: insertErr } = await supabase
    .from('technical_bulletin_reports')
    .insert(payload)
    .select('*')
    .single();
  if (insertErr) {
    throw new Error(`technical_bulletin_reports insert failed: ${insertErr.message}`);
  }
  return inserted as BulletinReportRow;
}

/**
 * Resolve a previewable/downloadable signed URL for a stored report.
 */
export async function getBulletinReportUrl(
  report: Pick<BulletinReportRow, 'file_path'>,
): Promise<string> {
  if (!report.file_path) throw new Error('Report has no file_path');
  const { data, error } = await supabase
    .storage
    .from(TECHNICAL_BULLETINS_BUCKET)
    .createSignedUrl(report.file_path, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) {
    throw new Error(`Could not get signed URL: ${error?.message || 'unknown error'}`);
  }
  return data.signedUrl;
}

/**
 * Load every stored report row for a given bulletin_id, newest first.
 */
export async function listBulletinReports(bulletinId: string): Promise<BulletinReportRow[]> {
  if (!bulletinId) return [];
  const { data, error } = await supabase
    .from('technical_bulletin_reports')
    .select('*')
    .eq('bulletin_id', String(bulletinId))
    .order('generated_at', { ascending: false });
  if (error) {
    console.error('listBulletinReports error:', error);
    return [];
  }
  return (data || []) as BulletinReportRow[];
}
