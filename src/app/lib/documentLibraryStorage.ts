/**
 * Shared Supabase Storage flow for the Document Library.
 *
 * Reference documents (Manuals / Diagrams / How-To's / Best Practices) are
 * uploaded to the private `document-library` bucket and tracked in the
 * `document_library` table so every authenticated user sees the same set.
 *
 * Bucket + table setup lives in
 *   database-migrations/document_library_storage.sql
 *
 * Customer-facing "share" links are long-lived signed URLs (the bucket
 * stays private). Supabase caps signed-URL TTL well above a year, so we
 * mint effectively-permanent links (10 years).
 */
import { supabase } from './supabase';

export const DOCUMENT_LIBRARY_BUCKET = 'document-library';

export const DOC_CATEGORIES = [
  'Manuals',
  'Diagrams',
  "How-To's",
  'Best Practices',
] as const;
export type DocCategory = (typeof DOC_CATEGORIES)[number];

// Effectively-permanent share link (10 years, in seconds).
const SHARE_URL_TTL_SECONDS = 60 * 60 * 24 * 365 * 10;

export interface DocumentRow {
  id: string;
  title: string;
  description: string | null;
  category: string;
  product_line: string | null;
  file_path: string;
  file_name: string;
  file_size: number | null;
  content_type: string | null;
  uploaded_by: string | null;
  uploaded_by_name: string | null;
  created_at: string;
  updated_at: string;
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

/**
 * Upload a file to the document-library bucket and record it in the
 * document_library table. Requires a real authenticated session (RLS gates
 * the bucket on auth.role() = 'authenticated').
 */
export async function uploadDocument(params: {
  file: File;
  title: string;
  description?: string | null;
  category: string;
  productLine?: string | null;
  uploadedBy?: string | null;
  uploadedByName?: string | null;
}): Promise<DocumentRow> {
  const { file, title, description, category, productLine, uploadedBy, uploadedByName } = params;
  if (!title) throw new Error('A title is required to upload a document');

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    throw new Error(
      'You must sign in with a real account (email/password or Google) to upload documents. ' +
      'The demo auto-login cannot upload to shared storage.'
    );
  }

  const safe = sanitizeName(file.name || 'document');
  const path = `${category}/${Date.now()}-${safe}`;

  const { error: uploadErr } = await supabase
    .storage
    .from(DOCUMENT_LIBRARY_BUCKET)
    .upload(path, file, {
      contentType: file.type || 'application/octet-stream',
      cacheControl: '3600',
      upsert: true,
    });
  if (uploadErr) {
    throw new Error(`Storage upload failed: ${uploadErr.message}`);
  }

  const payload = {
    title,
    description: description || null,
    category,
    product_line: productLine || null,
    file_path: path,
    file_name: file.name || safe,
    file_size: file.size ?? null,
    content_type: file.type || null,
    uploaded_by: uploadedBy || null,
    uploaded_by_name: uploadedByName || null,
  };

  const { data: inserted, error: insertErr } = await supabase
    .from('document_library')
    .insert(payload)
    .select('*')
    .single();
  if (insertErr) {
    // Best-effort cleanup of the uploaded object if the row insert fails.
    await supabase.storage.from(DOCUMENT_LIBRARY_BUCKET).remove([path]).catch(() => {});
    throw new Error(`document_library insert failed: ${insertErr.message}`);
  }
  return inserted as DocumentRow;
}

/** Load every document, newest first. */
export async function listDocuments(): Promise<DocumentRow[]> {
  const { data, error } = await supabase
    .from('document_library')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    console.error('listDocuments error:', error);
    throw error;
  }
  return (data || []) as DocumentRow[];
}

/** Mint a short-lived signed URL for in-app preview / download. */
export async function getDocumentUrl(doc: Pick<DocumentRow, 'file_path'>): Promise<string> {
  const { data, error } = await supabase
    .storage
    .from(DOCUMENT_LIBRARY_BUCKET)
    .createSignedUrl(doc.file_path, 60 * 60); // 1 hour for in-app use
  if (error || !data?.signedUrl) {
    throw new Error(`Could not get signed URL: ${error?.message || 'unknown error'}`);
  }
  return data.signedUrl;
}

/**
 * Mint an effectively-permanent signed URL suitable for sending to a
 * customer. The bucket stays private; this link grants read access to the
 * single object for ~10 years.
 */
export async function getDocumentShareUrl(doc: Pick<DocumentRow, 'file_path' | 'file_name'>): Promise<string> {
  const { data, error } = await supabase
    .storage
    .from(DOCUMENT_LIBRARY_BUCKET)
    .createSignedUrl(doc.file_path, SHARE_URL_TTL_SECONDS, {
      download: doc.file_name || true,
    });
  if (error || !data?.signedUrl) {
    throw new Error(`Could not create share link: ${error?.message || 'unknown error'}`);
  }
  return data.signedUrl;
}

/** Delete a document row + its underlying storage object. */
export async function deleteDocument(doc: Pick<DocumentRow, 'id' | 'file_path'>): Promise<void> {
  await supabase.storage.from(DOCUMENT_LIBRARY_BUCKET).remove([doc.file_path]).catch(() => {});
  const { error } = await supabase.from('document_library').delete().eq('id', doc.id);
  if (error) throw new Error(`Failed to delete document: ${error.message}`);
}
