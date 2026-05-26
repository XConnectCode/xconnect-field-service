/**
 * Generic CSV -> Supabase importer driven by a JSON config per table.
 *
 * Configs live in scripts/configs/<table>.json and define:
 *   - table:           Supabase table name
 *   - mode:            'preserve-edits' | 'full-overwrite' | 'append-only'
 *   - match_on:        DB column used as the natural key for upsert matching
 *   - column_map:      CSV header  ->  DB column
 *   - skip_columns:    CSV headers to ignore (computed/related columns)
 *   - fk_resolution:   { db_column: { table, match, return } }
 *   - date_fields:     DB columns to parse as date (M/D/YYYY -> YYYY-MM-DD)
 *   - datetime_fields: DB columns to parse as timestamp (M/D/YYYY h:mm AM/PM -> ISO)
 *   - enum_normalize:  { db_column: { from_value: to_value } }
 *
 * Behaviour:
 *   - preserve-edits: insert new rows; for existing matches only fill null/empty fields
 *   - full-overwrite: insert new rows; for existing matches overwrite every mapped field
 *   - append-only:    insert new rows; skip existing matches entirely
 *
 * Required env:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_KEY
 *
 * Run:
 *   pnpm tsx scripts/import-table.ts --table=fieldvisits --csv=scripts/fieldvisits.csv --dry-run --limit=10
 */

import { createClient } from '@supabase/supabase-js';
import { parse } from 'csv-parse/sync';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { randomBytes } from 'crypto';

// ── Args & env ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const argVal = (k: string): string | undefined => {
  const a = args.find((x) => x.startsWith(`--${k}=`));
  return a ? a.split('=').slice(1).join('=') : undefined;
};
const tableName = argVal('table');
const csvPath = argVal('csv');
const dryRun = args.includes('--dry-run');
const limit = parseInt(argVal('limit') || '0', 10) || Infinity;

if (!tableName) throw new Error('Missing --table=<name>');
if (!csvPath) throw new Error('Missing --csv=<path>');
const configPath = resolve(`scripts/configs/${tableName}.json`);
const csvResolved = resolve(csvPath);
if (!existsSync(configPath)) throw new Error(`Config not found at ${configPath}`);
if (!existsSync(csvResolved)) throw new Error(`CSV not found at ${csvResolved}`);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL) throw new Error('Missing SUPABASE_URL env var');
if (!SUPABASE_SERVICE_KEY) throw new Error('Missing SUPABASE_SERVICE_KEY env var');

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── Config types ──────────────────────────────────────────────────────────────
type FkRule = { table: string; match: string; return: string };
type Config = {
  table: string;
  mode: 'preserve-edits' | 'full-overwrite' | 'append-only';
  match_on: string;
  column_map: Record<string, string>;
  skip_columns?: string[];
  fk_resolution?: Record<string, FkRule>;
  date_fields?: string[];
  datetime_fields?: string[];
  enum_normalize?: Record<string, Record<string, string>>;
};
const config: Config = JSON.parse(readFileSync(configPath, 'utf-8'));

// ── Helpers ───────────────────────────────────────────────────────────────────
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

// AppSheet-style 22-char unique row_id (base64url, safe for text PKs)
function generateRowId(): string {
  return randomBytes(16).toString('base64url').slice(0, 22);
}

// M/D/YYYY -> YYYY-MM-DD
function toIsoDate(s: string): string | null {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

// M/D/YYYY h:mm AM/PM -> ISO 8601 timestamp (assumes user local; emitted as UTC)
function toIsoDateTime(s: string): string | null {
  if (!s) return null;
  // Already ISO?
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s;
  const m = s.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i,
  );
  if (!m) {
    // fall back to Date parsing
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  let [_, mm, dd, yy, hh, mi, ss, ap] = m;
  let h = parseInt(hh, 10);
  if (ap) {
    const isPM = ap.toUpperCase() === 'PM';
    if (isPM && h < 12) h += 12;
    if (!isPM && h === 12) h = 0;
  }
  const iso =
    `${yy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}T` +
    `${String(h).padStart(2, '0')}:${mi}:${(ss || '00').padStart(2, '0')}`;
  return iso; // no TZ -> Postgres stores as-is for timestamp; for timestamptz, assumes UTC
}

function cleanValue(dbCol: string, raw: any): any {
  const v = String(raw ?? '').trim();
  if (!v) return null;
  if (config.date_fields?.includes(dbCol)) return toIsoDate(v);
  if (config.datetime_fields?.includes(dbCol)) return toIsoDateTime(v);
  return v;
}

// ── FK lookups ────────────────────────────────────────────────────────────────
type FkMap = Map<string, string>; // CSV-name -> row_id (or other return col)
const fkMaps = new Map<string, FkMap>();
const unresolved: Record<string, Set<string>> = {};

async function loadFkLookups() {
  const rules = config.fk_resolution || {};
  for (const [dbCol, rule] of Object.entries(rules)) {
    console.log(`  Loading FK lookup ${dbCol} from ${rule.table}.${rule.match}`);
    const rows = await fetchAll(rule.table, `${rule.match}, ${rule.return}`);
    const map: FkMap = new Map();
    for (const r of rows) {
      const k = r[rule.match];
      const v = r[rule.return];
      if (k && v) map.set(String(k).trim(), String(v));
    }
    fkMaps.set(dbCol, map);
    console.log(`    -> ${map.size} entries`);
  }
}

function resolveFks(payload: Record<string, any>): Record<string, any> {
  const out = { ...payload };
  for (const [dbCol] of Object.entries(config.fk_resolution || {})) {
    const v = out[dbCol];
    if (!v) continue;
    const map = fkMaps.get(dbCol)!;
    const resolved = map.get(String(v).trim());
    if (resolved) {
      out[dbCol] = resolved;
    } else {
      out[dbCol] = null;
      if (!unresolved[dbCol]) unresolved[dbCol] = new Set();
      unresolved[dbCol].add(String(v));
    }
  }
  // enum normalize
  for (const [col, mapping] of Object.entries(config.enum_normalize || {})) {
    const v = out[col];
    if (v && mapping[v]) out[col] = mapping[v];
  }
  return out;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${'═'.repeat(72)}`);
  console.log(`Generic CSV importer`);
  console.log(`${'═'.repeat(72)}`);
  console.log(`Table:    ${config.table}`);
  console.log(`Mode:     ${config.mode}`);
  console.log(`Match on: ${config.match_on}`);
  console.log(`CSV:      ${csvResolved}`);
  console.log(`Dry run:  ${dryRun}`);
  console.log(`Limit:    ${limit === Infinity ? 'all' : limit}`);
  console.log('');

  // Parse CSV
  const raw = readFileSync(csvResolved, 'utf-8');
  const records: any[] = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_column_count: true,
    relax_quotes: true,
  });
  console.log(`Parsed ${records.length} rows from CSV\n`);

  // Pre-fetch existing rows by match_on
  console.log(`Fetching existing rows from ${config.table}...`);
  const existing = await fetchAll(config.table, '*');
  const existingByKey = new Map<string, any>();
  for (const r of existing) {
    const k = r[config.match_on];
    if (k !== undefined && k !== null) existingByKey.set(String(k).trim(), r);
  }
  console.log(`Found ${existing.length} existing rows (indexed by ${config.match_on})\n`);

  // Load FK lookups
  if (config.fk_resolution && Object.keys(config.fk_resolution).length) {
    console.log('Loading FK lookups...');
    await loadFkLookups();
    console.log('');
  }

  let inserted = 0,
    updated = 0,
    skipped = 0,
    noChange = 0,
    processed = 0,
    errors = 0;

  for (const row of records) {
    if (processed >= limit) break;
    // Build CSV->DB payload
    const fromCsv: Record<string, any> = {};
    for (const [csvCol, dbCol] of Object.entries(config.column_map)) {
      const raw = row[csvCol];
      fromCsv[dbCol] = cleanValue(dbCol, raw);
    }
    const keyVal = fromCsv[config.match_on];
    if (!keyVal) {
      console.log(`  ⚠ skipping row without ${config.match_on}`);
      skipped++;
      continue;
    }
    processed++;

    // Resolve FKs + enum normalize
    const resolved = resolveFks(fromCsv);

    const existingRow = existingByKey.get(String(keyVal).trim());
    const isNew = !existingRow;
    const label = `[${processed}] ${config.match_on}=${keyVal}`;

    if (isNew) {
      // Generate a row_id if the target table uses one and the CSV doesn't include it
      if (!resolved.row_id) resolved.row_id = generateRowId();

      if (!dryRun) {
        const { error } = await supabase.from(config.table).insert(resolved);
        if (error) {
          console.error(`${label} ✗ insert failed: ${error.message}`);
          errors++;
          continue;
        }
      }
      inserted++;
      console.log(`${label} + insert`);
    } else if (config.mode === 'append-only') {
      noChange++;
      // silent skip; too noisy otherwise
    } else {
      // Build update payload
      let payload: Record<string, any> = {};
      if (config.mode === 'full-overwrite') {
        // overwrite every mapped column
        for (const [, dbCol] of Object.entries(config.column_map)) {
          if (dbCol in resolved) payload[dbCol] = resolved[dbCol];
        }
      } else {
        // preserve-edits: only fill null/empty
        for (const [k, v] of Object.entries(resolved)) {
          const cur = existingRow[k];
          const isEmpty = cur === null || cur === undefined || cur === '';
          if (isEmpty && v !== null) payload[k] = v;
        }
      }

      if (Object.keys(payload).length === 0) {
        noChange++;
        continue;
      }
      if (!dryRun) {
        const { error } = await supabase
          .from(config.table)
          .update(payload)
          .eq(config.match_on, keyVal);
        if (error) {
          console.error(`${label} ✗ update failed: ${error.message}`);
          errors++;
          continue;
        }
      }
      updated++;
      console.log(`${label} ~ update ${Object.keys(payload).length} field(s)`);
    }
  }

  console.log(`\n${'═'.repeat(72)}`);
  console.log('Summary');
  console.log(`${'═'.repeat(72)}`);
  console.log(`Rows processed:  ${processed}`);
  console.log(`  ↳ inserted:    ${inserted}`);
  console.log(`  ↳ updated:     ${updated}`);
  console.log(`  ↳ no change:   ${noChange}`);
  console.log(`  ↳ skipped:     ${skipped}`);
  console.log(`  ↳ errors:      ${errors}`);

  const ukeys = Object.keys(unresolved);
  if (ukeys.length) {
    console.log(`\nUnresolved FK values (stored as null):`);
    for (const k of ukeys) {
      const vals = Array.from(unresolved[k]).sort();
      console.log(`  ${k} (${vals.length}):`);
      for (const v of vals.slice(0, 50)) console.log(`    - ${v}`);
      if (vals.length > 50) console.log(`    ... +${vals.length - 50} more`);
    }
  }
  console.log('');
}

main().catch((err) => {
  console.error('\n✗ Fatal error:', err);
  process.exit(1);
});
