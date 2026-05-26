/**
 * AppSheet CSV → Supabase importer.
 *
 * What it does:
 *   1. Parses the CSV at scripts/import.csv (or path from --csv flag).
 *   2. For each row's Image1, Image2, Incident Report URLs:
 *      - downloads the binary from AppSheet (using your cookie)
 *      - uploads to Supabase Storage at incident-images/{event_id}/imageN.ext
 *        and incident-reports/{event_id}/appsheet-original.pdf
 *      - records the resulting public URL
 *   3. Upserts each row into the incidents table by event_id, with PRESERVE EDITS
 *      logic (only writes a field if the existing DB value is null/empty).
 *   4. Inserts an incident_reports row for each non-empty Incident Report cell.
 *
 * How to run (from your Codespace terminal):
 *   1. export SUPABASE_URL='https://gbllxumuogsncoiaksum.supabase.co'
 *   2. export SUPABASE_SERVICE_KEY='<service_role key from Supabase dashboard>'
 *   3. Place your CSV at scripts/import.csv (or pass --csv=path)
 *   4. Dry run first: pnpm tsx scripts/import-appsheet-csv.ts --dry-run --limit=2
 *   5. Real run:    pnpm tsx scripts/import-appsheet-csv.ts
 *
 * Note: APPSHEET_COOKIE is NOT required — AppSheet image/report URLs in the
 * CSV are pre-signed (signature= query param), so they download with just a
 * normal browser User-Agent. The cookie is supported as a fallback if needed.
 *
 * Safe to re-run. Files are deterministic per event_id, so re-runs overwrite
 * cleanly. Incidents are upserted with preserve-edits so post-import UI edits
 * are not clobbered.
 */

import { createClient } from '@supabase/supabase-js';
import { parse } from 'csv-parse/sync';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// ── Config ────────────────────────────────────────────────────────────────────
const APPSHEET_COOKIE = process.env.APPSHEET_COOKIE;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const BUCKET = 'Native Files';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitArg = args.find((a) => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : Infinity;
const csvArg = args.find((a) => a.startsWith('--csv='));
const csvPath = resolve(csvArg ? csvArg.split('=')[1] : 'scripts/import.csv');
const startEventIdArg = args.find((a) => a.startsWith('--start='));
const startEventId = startEventIdArg ? parseInt(startEventIdArg.split('=')[1], 10) : 0;

// APPSHEET_COOKIE is optional — the AppSheet `getimageurl` URLs are pre-signed
// (signature= param in query string), so they work without a session cookie
// as long as we send a normal browser User-Agent. If a cookie is provided, we
// pass it along as a fallback.
if (!SUPABASE_URL) throw new Error('Missing SUPABASE_URL env var');
if (!SUPABASE_SERVICE_KEY) throw new Error('Missing SUPABASE_SERVICE_KEY env var');
if (!existsSync(csvPath)) throw new Error(`CSV not found at ${csvPath}`);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── Mapping: AppSheet CSV header → Supabase column ────────────────────────────
const COLUMN_MAP: Record<string, string> = {
  'Event ID': 'event_id',
  'Date of Incident': 'date_incident',
  'Incident Status': 'incident_status',
  'Incident Severity': 'incident_severity',
  'Field or Facility': 'field_facility',
  'Notes': 'notes',
  'Customer Rep/Crew/Fleet': 'customer_rep',
  'Operator Representative': 'ep_rep',
  'Well Name and #': 'well_name',
  'Stage #': 'stage_number',
  'District providing material': 'xc_district',
  'XC Products Gun System': 'product_line',
  'Firing System Being Used': 'firing_system',
  'Caused by XConnect': 'xc_caused',
  'Event Category': 'event_category',
  'Caused by Vendor': 'vendor_caused',
  'Sales Order #': 'so_number',
  'Description of Incident': 'incident_description',
  'Investigation and Troubleshooting': 'investigation',
  'Root Cause/Conclusion': 'root_cause',
  'Report Sent': 'report_sent',
  'Slack URL': 'slack_url',
  'Customer District': 'customer_district',
  'Field Visit ID': 'field_visit_id',
  'XC Representative': 'xc_rep',
  'Operating Company': 'operating_company',
  'Vendor': 'vendor',
  'Failed Component': 'failed_component',
  'Customer': 'customer',
  'Failure Type': 'failure_type',
  // Image1/Image2/Incident Report handled separately
  // Incident Summary has no DB column — skipped
  // Related Images skipped per user instructions
};

const DATE_FIELDS = new Set(['date_incident', 'action_due_date', 'closed_date']);

// ── Enum value normalization ──────────────────────────────────────────────────
// CSV uses slightly different labels than the Postgres enum in a few cases.
const ENUM_NORMALIZE: Record<string, Record<string, string>> = {
  xc_caused: {
    'Under Investigation': 'Pending Investigation',
  },
};

// ── Foreign-key resolution ────────────────────────────────────────────────────
// These DB columns store a row_id (or PK text) that points at a lookup table.
// For each, we build a map of (CSV name) -> row_id at start of run.
//
//   customer            -> customers.row_id            keyed by customers.customer
//   customer_district   -> districts.row_id            keyed by districts.customer_district
//   failed_component    -> lists.row_id                keyed by lists.failed_component
//   field_visit_id      -> fieldvisits.field_visit_id  PK match (just verify exists)
//   xc_rep              -> sqm.sq_manager              PK match (just verify exists)
type LookupMaps = {
  customer: Map<string, string>;
  customer_district: Map<string, string>;
  failed_component: Map<string, string>;
  field_visit_id: Set<string>;
  xc_rep: Set<string>;
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const isAppSheetUrl = (s: string | undefined): s is string =>
  !!s && s.startsWith('https://www.appsheet.com/');

// Parse AppSheet URL to extract the original filename (e.g. Incident_Images/X.Image1.180444.jpg)
const extractAppSheetFileName = (url: string): string => {
  const m = url.match(/fileName=([^&]+)/);
  if (!m) return 'unknown';
  return decodeURIComponent(m[1]);
};

// Get extension from filename
const extOf = (name: string): string => {
  const m = name.match(/\.([a-zA-Z0-9]{1,5})(?:\?|$)/);
  return m ? m[1].toLowerCase() : 'bin';
};

// Convert M/D/YYYY → YYYY-MM-DD
const toIsoDate = (s: string): string | null => {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10); // already iso
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const [_, mm, dd, yy] = m;
  return `${yy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
};

// Normalize empty strings → null
const cleanValue = (col: string, raw: string): string | null => {
  const v = (raw ?? '').trim();
  if (!v) return null;
  if (DATE_FIELDS.has(col)) return toIsoDate(v);
  return v;
};

// Download a binary from AppSheet. The getimageurl URLs are pre-signed and
// redirect (302) to a CDN URL (e.g. googleusercontent.com / S3). fetch() in
// Node 20+ follows redirects by default. We send browser-like headers to
// avoid being treated as a bot.
async function downloadAppSheet(url: string): Promise<{ buffer: Buffer; contentType: string }> {
  const headers: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,application/pdf,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    Referer: 'https://www.appsheet.com/',
  };
  if (APPSHEET_COOKIE) headers.Cookie = APPSHEET_COOKIE;
  const res = await fetch(url, { headers, redirect: 'follow' });
  if (!res.ok) throw new Error(`Download failed ${res.status}: ${url.slice(0, 120)}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length < 100) throw new Error(`Suspiciously small file (${buffer.length} bytes)`);
  const contentType = res.headers.get('content-type') || 'application/octet-stream';
  return { buffer, contentType };
}

// Upload to Supabase Storage, return public URL
async function uploadToStorage(
  path: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  const { error } = await supabase.storage.from(BUCKET).upload(path, buffer, {
    contentType,
    upsert: true, // overwrite if re-running
  });
  if (error) throw new Error(`Storage upload failed at ${path}: ${error.message}`);
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

// Pipeline: AppSheet URL → Storage URL
async function transferFile(
  appSheetUrl: string,
  destPath: string,
): Promise<string | null> {
  try {
    const { buffer, contentType } = await downloadAppSheet(appSheetUrl);
    if (dryRun) {
      console.log(`    [dry-run] would upload ${buffer.length} bytes → ${destPath}`);
      return `[dry-run]/${destPath}`;
    }
    const publicUrl = await uploadToStorage(destPath, buffer, contentType);
    return publicUrl;
  } catch (err: any) {
    console.error(`    ✗ ${destPath}: ${err.message}`);
    return null;
  }
}

// ── Lookup table loader ───────────────────────────────────────────────────────
// Supabase JS client caps a single select at 1000 rows (PostgREST default).
// We paginate to make sure we load *all* rows from each lookup table.
async function fetchAll(table: string, columns: string): Promise<any[]> {
  const PAGE = 1000;
  let from = 0;
  const out: any[] = [];
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table} fetch: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

async function loadLookups(): Promise<LookupMaps> {
  console.log('Loading lookup tables (customers, districts, lists, fieldvisits, sqm)...');
  const [cRows, dRows, lRows, fvRows, sRows] = await Promise.all([
    fetchAll('customers', 'row_id, customer'),
    fetchAll('districts', 'row_id, customer_district'),
    fetchAll('lists', 'row_id, failed_component'),
    fetchAll('fieldvisits', 'field_visit_id'),
    fetchAll('sqm', 'sq_manager'),
  ]);

  const customer = new Map<string, string>();
  for (const r of cRows) if (r.customer && r.row_id) customer.set(r.customer.trim(), r.row_id);

  const customer_district = new Map<string, string>();
  for (const r of dRows) if (r.customer_district && r.row_id) customer_district.set(r.customer_district.trim(), r.row_id);

  const failed_component = new Map<string, string>();
  for (const r of lRows) if (r.failed_component && r.row_id) failed_component.set(r.failed_component.trim(), r.row_id);

  const field_visit_id = new Set<string>();
  for (const r of fvRows) if (r.field_visit_id) field_visit_id.add(String(r.field_visit_id).trim());

  const xc_rep = new Set<string>();
  for (const r of sRows) if (r.sq_manager) xc_rep.add(r.sq_manager.trim());

  console.log(
    `  customers: ${customer.size} | districts: ${customer_district.size} | lists: ${failed_component.size} | fieldvisits: ${field_visit_id.size} | sqm: ${xc_rep.size}\n`,
  );
  return { customer, customer_district, failed_component, field_visit_id, xc_rep };
}

// Resolve FK columns: replace name strings with row_ids; null + warn on miss.
function resolveForeignKeys(
  eventId: string,
  payload: Record<string, any>,
  lookups: LookupMaps,
  unresolved: Record<string, Set<string>>,
): Record<string, any> {
  const out = { ...payload };

  const resolveMap = (col: keyof LookupMaps & ('customer' | 'customer_district' | 'failed_component')) => {
    const v = out[col];
    if (!v) return;
    const map = lookups[col] as Map<string, string>;
    const rowId = map.get(String(v).trim());
    if (rowId) {
      out[col] = rowId;
    } else {
      console.log(`  ⚠ ${col} "${v}" not found in lookup — setting null`);
      out[col] = null;
      if (!unresolved[col]) unresolved[col] = new Set();
      unresolved[col].add(String(v));
    }
  };

  const resolveSet = (col: keyof LookupMaps & ('field_visit_id' | 'xc_rep')) => {
    const v = out[col];
    if (!v) return;
    const set = lookups[col] as Set<string>;
    if (!set.has(String(v).trim())) {
      console.log(`  ⚠ ${col} "${v}" not found in lookup — setting null`);
      out[col] = null;
      if (!unresolved[col]) unresolved[col] = new Set();
      unresolved[col].add(String(v));
    }
  };

  resolveMap('customer');
  resolveMap('customer_district');
  resolveMap('failed_component');
  resolveSet('field_visit_id');
  resolveSet('xc_rep');

  // Enum normalization
  for (const [col, mapping] of Object.entries(ENUM_NORMALIZE)) {
    const v = out[col];
    if (v && mapping[v]) {
      out[col] = mapping[v];
    }
  }

  return out;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${'═'.repeat(72)}`);
  console.log(`AppSheet CSV → Supabase importer`);
  console.log(`${'═'.repeat(72)}`);
  console.log(`CSV:      ${csvPath}`);
  console.log(`Bucket:   ${BUCKET}`);
  console.log(`Dry run:  ${dryRun}`);
  console.log(`Limit:    ${limit === Infinity ? 'all' : limit}`);
  if (startEventId) console.log(`Start at: event_id >= ${startEventId}`);
  console.log('');

  // Parse CSV
  const raw = readFileSync(csvPath, 'utf-8');
  const records: any[] = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_column_count: true,
  });
  console.log(`Parsed ${records.length} rows from CSV\n`);

  // Pre-fetch existing incidents (paginated) to make preserve-edits decisions in-memory
  console.log('Fetching existing incidents from Supabase...');
  const existingRows = await fetchAll('incidents', '*');
  const existingByEventId = new Map(
    existingRows.map((r: any) => [String(r.event_id), r]),
  );
  console.log(`Found ${existingRows.length} existing incidents\n`);

  // Load FK lookup tables
  const lookups = await loadLookups();
  const unresolved: Record<string, Set<string>> = {};

  let inserted = 0,
    updated = 0,
    skipped = 0,
    filesOK = 0,
    filesFail = 0,
    reportsAdded = 0;

  let processed = 0;
  for (const row of records) {
    const eventId = (row['Event ID'] || '').trim();
    if (!eventId) {
      console.log(`  ⚠ skipping row without Event ID`);
      skipped++;
      continue;
    }
    if (startEventId && parseInt(eventId, 10) < startEventId) {
      skipped++;
      continue;
    }
    if (processed >= limit) break;
    processed++;

    console.log(`[${processed}] Event ${eventId}`);

    const existing = existingByEventId.get(eventId);
    const isNew = !existing;

    // ── Handle Image1 ──
    let image1Url: string | null = null;
    if (isAppSheetUrl(row['Image1'])) {
      const fname = extractAppSheetFileName(row['Image1']);
      const ext = extOf(fname);
      const path = `incident-images/${eventId}/image1.${ext}`;
      console.log(`  ↓ Image1 (${fname.slice(0, 60)})`);
      const url = await transferFile(row['Image1'], path);
      if (url) {
        image1Url = url;
        filesOK++;
      } else {
        filesFail++;
      }
    }

    // ── Handle Image2 ──
    let image2Url: string | null = null;
    if (isAppSheetUrl(row['Image2'])) {
      const fname = extractAppSheetFileName(row['Image2']);
      const ext = extOf(fname);
      const path = `incident-images/${eventId}/image2.${ext}`;
      console.log(`  ↓ Image2 (${fname.slice(0, 60)})`);
      const url = await transferFile(row['Image2'], path);
      if (url) {
        image2Url = url;
        filesOK++;
      } else {
        filesFail++;
      }
    }

    // ── Handle Incident Report PDF ──
    let reportUrl: string | null = null;
    let reportFileName: string | null = null;
    if (isAppSheetUrl(row['Incident Report'])) {
      const fname = extractAppSheetFileName(row['Incident Report']);
      reportFileName = fname.split('/').pop() || fname;
      const ext = extOf(fname) || 'pdf';
      const path = `incident-reports/${eventId}/appsheet-original.${ext}`;
      console.log(`  ↓ Incident Report (${reportFileName.slice(0, 60)})`);
      const url = await transferFile(row['Incident Report'], path);
      if (url) {
        reportUrl = url;
        filesOK++;
      } else {
        filesFail++;
      }
    }

    // ── Build incident payload from CSV ──
    const fromCsvRaw: Record<string, any> = {};
    for (const [csvCol, dbCol] of Object.entries(COLUMN_MAP)) {
      fromCsvRaw[dbCol] = cleanValue(dbCol, row[csvCol]);
    }
    if (image1Url) fromCsvRaw['image1'] = image1Url;
    if (image2Url) fromCsvRaw['image2'] = image2Url;

    // Resolve foreign keys and normalize enums
    const fromCsv = resolveForeignKeys(eventId, fromCsvRaw, lookups, unresolved);

    // ── Preserve-edits merge: only write fields that are null/empty in DB ──
    let finalPayload: Record<string, any> = {};
    if (isNew) {
      finalPayload = fromCsv;
    } else {
      for (const [k, v] of Object.entries(fromCsv)) {
        const existingVal = existing[k];
        const isEmpty =
          existingVal === null || existingVal === undefined || existingVal === '';
        if (isEmpty && v !== null) finalPayload[k] = v;
      }
      // Always update event_id (no-op but ensures key)
      finalPayload['event_id'] = eventId;
    }

    // ── Write incident ──
    if (Object.keys(finalPayload).length > 0) {
      if (isNew) {
        if (!dryRun) {
          const { error } = await supabase.from('incidents').insert(finalPayload);
          if (error) {
            console.error(`  ✗ insert failed: ${error.message}`);
            continue;
          }
        }
        inserted++;
        console.log(`  + inserted new incident`);
      } else if (Object.keys(finalPayload).length > 1) {
        // > 1 because event_id is always there for updates
        if (!dryRun) {
          const { error } = await supabase
            .from('incidents')
            .update(finalPayload)
            .eq('event_id', eventId);
          if (error) {
            console.error(`  ✗ update failed: ${error.message}`);
            continue;
          }
        }
        updated++;
        console.log(`  ~ updated ${Object.keys(finalPayload).length - 1} field(s)`);
      } else {
        console.log(`  · no changes (all fields already populated)`);
      }
    }

    // ── Insert incident_reports row for the PDF ──
    if (reportUrl) {
      if (!dryRun) {
        // Check if AppSheet Original already exists for this incident
        const { data: existingReports } = await supabase
          .from('incident_reports')
          .select('row_id')
          .eq('event_id', eventId)
          .eq('report_type', 'AppSheet Original');
        if (existingReports && existingReports.length > 0) {
          // Update existing
          await supabase
            .from('incident_reports')
            .update({ file_url: reportUrl, file_name: reportFileName })
            .eq('row_id', existingReports[0].row_id);
        } else {
          await supabase.from('incident_reports').insert({
            event_id: eventId,
            report_type: 'AppSheet Original',
            file_url: reportUrl,
            file_name: reportFileName,
            generated_by: 'AppSheet Import',
          });
          reportsAdded++;
        }
      } else {
        reportsAdded++;
      }
    }

    // Tiny pause to be polite to AppSheet
    await sleep(150);
  }

  console.log(`\n${'═'.repeat(72)}`);
  console.log(`Summary`);
  console.log(`${'═'.repeat(72)}`);
  console.log(`Rows processed:        ${processed}`);
  console.log(`  ↳ inserted:          ${inserted}`);
  console.log(`  ↳ updated:           ${updated}`);
  console.log(`  ↳ skipped:           ${skipped}`);
  console.log(`Files transferred OK:  ${filesOK}`);
  console.log(`Files failed:          ${filesFail}`);
  console.log(`Reports added:         ${reportsAdded}`);

  // Report any unresolved FK values so the user can backfill lookup tables
  const unresolvedKeys = Object.keys(unresolved);
  if (unresolvedKeys.length) {
    console.log(`\nUnresolved FK values (set to null in incidents):`);
    for (const k of unresolvedKeys) {
      const vals = Array.from(unresolved[k]).sort();
      console.log(`  ${k} (${vals.length}):`);
      for (const v of vals) console.log(`    - ${v}`);
    }
  }
  console.log('');
}

main().catch((err) => {
  console.error('\n✗ Fatal error:', err);
  process.exit(1);
});
