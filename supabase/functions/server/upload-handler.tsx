import { createClient } from 'jsr:@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
);

const BUCKET_NAME = 'make-64775d98-incident-images';
const SIGNED_URL_TTL_SECONDS = 31536000; // 1 year
// Images plus PDFs (QC pallets store the imported NetSuite slip PDF).
const ALLOWED_MIME_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic',
  'application/pdf',
];

// ---------------------------------------------------------------------------
// Bucket init
// ---------------------------------------------------------------------------

/**
 * Initialize the images bucket if it doesn't exist.
 * (Name kept as "incident-images" for backward compatibility with the existing
 * bucket; it now stores polymorphic images.)
 */
export async function initializeIncidentImagesBucket() {
  try {
    const { data: buckets } = await supabase.storage.listBuckets();
    const bucketExists = buckets?.some(bucket => bucket.name === BUCKET_NAME);

    if (!bucketExists) {
      console.log(`Creating bucket: ${BUCKET_NAME}`);
      const { data, error } = await supabase.storage.createBucket(BUCKET_NAME, {
        public: false,
        fileSizeLimit: 10485760, // 10MB
        allowedMimeTypes: ALLOWED_MIME_TYPES,
      });
      if (error) {
        console.error('Error creating bucket:', error);
      } else {
        console.log('Bucket created successfully:', data);
      }
    } else {
      console.log(`Bucket ${BUCKET_NAME} already exists`);
      // Ensure the existing bucket allows the full mime list (e.g. PDFs added later).
      const { error: updErr } = await supabase.storage.updateBucket(BUCKET_NAME, {
        public: false,
        fileSizeLimit: 10485760,
        allowedMimeTypes: ALLOWED_MIME_TYPES,
      });
      if (updErr) console.error('Error updating bucket mime types:', updErr);
    }
  } catch (error) {
    console.error('Error initializing bucket:', error);
  }
}

// ---------------------------------------------------------------------------
// Polymorphic image handlers
// ---------------------------------------------------------------------------

export type ImageRecord = {
  id: string;
  parent_table: string;
  parent_row_id: string;
  field_name: string | null;
  storage_path: string;
  signedUrl: string | null;
  caption: string | null;
  source: string;
  mime_type: string | null;
  file_size_bytes: number | null;
  created_at: string;
};

const ALLOWED_PARENTS = new Set([
  'incidents',
  'panels',
  'panel_history',
  'customers',
  'districts',
  'fieldvisits',
  'components',
  'driver_loads',
  'qc_pallets',
]);

function isValidParentTable(t: string): boolean {
  return ALLOWED_PARENTS.has(t);
}

function extFromName(name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : 'bin';
}

/**
 * Upload an image and insert a row into public.images.
 *
 * Storage path: <parent_table>/<parent_row_id>/<uuid>.<ext>
 * Returns the inserted row's id, a fresh signed URL, and storage_path.
 */
export async function uploadImage(
  file: File,
  parentTable: string,
  parentRowId: string,
  opts: { fieldName?: string | null; source?: string; caption?: string | null } = {}
): Promise<{ id: string | null; url: string | null; storagePath: string | null; error: string | null }> {
  try {
    if (!isValidParentTable(parentTable)) {
      return { id: null, url: null, storagePath: null, error: `Unsupported parent_table: ${parentTable}` };
    }
    if (!parentRowId) {
      return { id: null, url: null, storagePath: null, error: 'parent_row_id is required' };
    }

    const ext = extFromName(file.name);
    const uuid = crypto.randomUUID();
    const storagePath = `${parentTable}/${parentRowId}/${uuid}.${ext}`;

    const arrayBuffer = await file.arrayBuffer();
    const fileData = new Uint8Array(arrayBuffer);

    const { error: upErr } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(storagePath, fileData, {
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      });
    if (upErr) {
      console.error('Storage upload error:', upErr);
      return { id: null, url: null, storagePath: null, error: upErr.message };
    }

    const { data: insRow, error: insErr } = await supabase
      .from('images')
      .insert({
        parent_table: parentTable,
        parent_row_id: parentRowId,
        field_name: opts.fieldName ?? null,
        storage_path: storagePath,
        source: opts.source ?? 'user-upload',
        caption: opts.caption ?? null,
        mime_type: file.type || null,
        file_size_bytes: file.size || null,
      })
      .select('id')
      .single();
    if (insErr) {
      // Roll back storage upload if DB insert fails.
      await supabase.storage.from(BUCKET_NAME).remove([storagePath]).catch(() => {});
      console.error('images insert error:', insErr);
      return { id: null, url: null, storagePath: null, error: insErr.message };
    }

    const { data: signed, error: signedErr } = await supabase.storage
      .from(BUCKET_NAME)
      .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
    if (signedErr) {
      console.error('Signed URL error:', signedErr);
      // Row + object are persisted; just return without a URL.
      return { id: insRow.id, url: null, storagePath, error: null };
    }

    return { id: insRow.id, url: signed.signedUrl, storagePath, error: null };
  } catch (error) {
    console.error('uploadImage exception:', error);
    return { id: null, url: null, storagePath: null, error: String(error) };
  }
}

/**
 * List all images for a given parent record, sourced from the `images` table
 * (NOT storage list — so backfilled / migrated rows are included).
 */
export async function listImagesForRecord(
  parentTable: string,
  parentRowId: string
): Promise<{ files: ImageRecord[]; error: string | null }> {
  try {
    if (!isValidParentTable(parentTable)) {
      return { files: [], error: `Unsupported parent_table: ${parentTable}` };
    }

    const { data: rows, error } = await supabase
      .from('images')
      .select('id,parent_table,parent_row_id,field_name,storage_path,caption,source,mime_type,file_size_bytes,created_at')
      .eq('parent_table', parentTable)
      .eq('parent_row_id', parentRowId)
      .order('created_at', { ascending: true });
    if (error) {
      console.error('images list error:', error);
      return { files: [], error: error.message };
    }

    // Sign each storage path in parallel.
    const paths = (rows ?? []).map(r => r.storage_path);
    const signedMap = new Map<string, string>();
    if (paths.length > 0) {
      const { data: signed, error: signedErr } = await supabase.storage
        .from(BUCKET_NAME)
        .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
      if (signedErr) {
        console.error('createSignedUrls error:', signedErr);
      } else {
        for (const s of signed ?? []) {
          if (s.path && s.signedUrl) signedMap.set(s.path, s.signedUrl);
        }
      }
    }

    // Frontend shape (camelCase, `url` not `signedUrl`). Keep snake_case keys too
    // for backward compat with any consumer that already uses them.
    const files: any[] = (rows ?? []).map(r => {
      const url = signedMap.get(r.storage_path) ?? null;
      return {
        // frontend-friendly camelCase
        id: r.id,
        url,
        storagePath: r.storage_path,
        fieldName: r.field_name,
        caption: r.caption,
        source: r.source,
        mimeType: r.mime_type,
        fileSizeBytes: r.file_size_bytes,
        createdAt: r.created_at,
        // legacy snake_case keys (do not remove)
        parent_table: r.parent_table,
        parent_row_id: r.parent_row_id,
        field_name: r.field_name,
        storage_path: r.storage_path,
        signedUrl: url,
        mime_type: r.mime_type,
        file_size_bytes: r.file_size_bytes,
        created_at: r.created_at,
      };
    });

    return { files, error: null };
  } catch (error) {
    console.error('listImagesForRecord exception:', error);
    return { files: [], error: String(error) };
  }
}

/**
 * Delete an image by its `images.id`: removes storage object + deletes row.
 */
export async function deleteImageById(
  imageId: string
): Promise<{ success: boolean; error: string | null }> {
  try {
    const { data: row, error: selErr } = await supabase
      .from('images')
      .select('storage_path')
      .eq('id', imageId)
      .maybeSingle();
    if (selErr) {
      console.error('image select error:', selErr);
      return { success: false, error: selErr.message };
    }
    if (!row) {
      return { success: false, error: 'image not found' };
    }

    const { error: rmErr } = await supabase.storage
      .from(BUCKET_NAME)
      .remove([row.storage_path]);
    if (rmErr) {
      console.warn('storage remove warning (continuing):', rmErr);
    }

    const { error: delErr } = await supabase
      .from('images')
      .delete()
      .eq('id', imageId);
    if (delErr) {
      console.error('image delete error:', delErr);
      return { success: false, error: delErr.message };
    }

    return { success: true, error: null };
  } catch (error) {
    console.error('deleteImageById exception:', error);
    return { success: false, error: String(error) };
  }
}

// ---------------------------------------------------------------------------
// Legacy incident-only wrappers (kept for backward compat with existing UI)
// ---------------------------------------------------------------------------

/**
 * Upload a file scoped to an incident.
 * Now backed by polymorphic uploadImage() — also inserts an images row.
 * Returns the new images.id additively so callers can opt in to ID-based delete.
 */
export async function uploadIncidentImage(
  file: File,
  incidentId: string
): Promise<{ url: string | null; id: string | null; error: string | null }> {
  const r = await uploadImage(file, 'incidents', incidentId, {
    source: 'user-upload',
  });
  return { url: r.url, id: r.id, error: r.error };
}

/**
 * Delete a file by signed-URL path or raw storage path (legacy shape).
 * Best-effort: also tries to remove a matching row from the images table.
 */
export async function deleteIncidentImage(
  filePath: string
): Promise<{ success: boolean; error: string | null }> {
  try {
    const pathMatch = filePath.match(/\/object\/sign\/[^\/]+\/(.+?)\?/);
    const actualPath = pathMatch ? pathMatch[1] : filePath;

    const { error: rmErr } = await supabase.storage
      .from(BUCKET_NAME)
      .remove([actualPath]);
    if (rmErr) {
      console.warn('legacy delete storage warning (continuing):', rmErr);
    }

    // Best-effort DB cleanup
    try {
      await supabase
        .from('images')
        .delete()
        .eq('storage_path', actualPath);
    } catch (e) {
      console.warn('legacy delete DB warning (continuing):', e);
    }

    return { success: true, error: null };
  } catch (error) {
    console.error('deleteIncidentImage exception:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * List images for an incident.
 * NOW sourced from the `images` table (not storage list) so that backfilled
 * Image1/Image2/Pictures rows show up in the gallery.
 *
 * Legacy response shape preserved: [{name, url, createdAt, size}] PLUS new
 * additive fields {id, field_name, source} for callers that want them.
 */
export async function listIncidentImages(incidentId: string) {
  const r = await listImagesForRecord('incidents', incidentId);
  if (r.error) return { files: [], error: r.error };
  const files = r.files.map(f => ({
    id: f.id,                                                 // NEW: additive
    name: f.storage_path.split('/').pop() ?? f.storage_path,
    url: f.signedUrl,
    createdAt: f.created_at,
    size: f.file_size_bytes,
    field_name: f.field_name,                                 // NEW: additive
    source: f.source,                                         // NEW: additive
  }));
  return { files, error: null };
}
