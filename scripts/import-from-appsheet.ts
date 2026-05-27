/**
 * AppSheet API -> Supabase importer.
 *
 * Pulls rows directly from the AppSheet App API (POST .../Action with Action="Find")
 * and routes them through the same per-table config used by import-table.ts.
 *
 * Why this beats CSV imports:
 *   - Includes AppSheet "Row ID", which IS the Supabase row_id (clean PK match)
 *   - No CSV export step
 *   - Always pulls the latest data
 *
 * Required env:
 *   APPSHEET_KEY       Application Access Key from AppSheet App -> Manage -> Integrations
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_KEY
 *
 * Run:
 *   pnpm tsx scripts/import-from-appsheet.ts --table=fieldvisits --dry-run --limit=5
 *   pnpm tsx scripts/import-from-appsheet.ts --table=fieldvisits
 *
 * Per-table behaviour comes from scripts/configs/<table>.json (same configs as import-table.ts).
 * Each config now also includes:
 *   - appsheet_table:  exact table name in AppSheet (e.g. "Field Visits")
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

// ── App-wide constants ────────────────────────────────────────────────────────
const APP_ID = '87bcc0a1-ac3f-4b51-8198-84b8274a5826';

// ── Args & env ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const argVal = (k: string): string | undefined => {
  const a = args.find((x) => x.startsWith(`--${k}=`));
  return a ? a.split('=').slice(1).join('=') : undefined;
};
const tableName = argVal('table');
const dryRun = args.includes('--dry-run');
const refetch = args.includes('--refetch');
const limit = parseInt(argVal('limit') || '0', 10) || Infinity;

if (!tableName) throw new Error('Missing --table=<name>');
const configPath = resolve(`scripts/configs/${tableName}.json`);
if (!existsSync(configPath)) throw new Error(`Config not found at ${configPath}`);

const APPSHEET_KEY = process.env.APPSHEET_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!APPSHEET_KEY) throw new Error('Missing APPSHEET_KEY env var');
if (!SUPABASE_URL) throw new Error('Missing SUPABASE_URL env var');
if (!SUPABASE_SERVICE_KEY) throw new Error('Missing SUPABASE_SERVICE_KEY env var');

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── Config ───────────────────────────────────────────────────────────────────
type FkRule = { table: string; match: string; return: string };
type Config = {
  table: string;
  appsheet_table: string;
  mode: 'preserve-edits' | 'full-overwrite' | 'append-only';
  match_on: string;
  column_map: Record<string, string>;
  fk_resolution?: Record<string, FkRule>;
  date_fields?: string[];
  datetime_fields?: string[];
  enum_normalize?: Record<string, Record<string, string>>;
};
const config: Config = JSON.parse(readFileSync(configPath, 'utf-8'));
if (!config.appsheet_table) {
  throw new Error(
    `Config ${tableName} is missing "appsheet_table" — add the AppSheet table name (e.g. "Field Visits") to use the API importer.`,
  );
}

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

function toIsoDate(s: string): string | null {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  // AppSheet sometimes returns MM/DD/YYYY HH:MM:SS for date columns; trim time off
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return null;
}

function toIsoDateTime(s: string): string | null {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s;
  // AppSheet 24-hr format: MM/DD/YYYY HH:MM:SS
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/);
  if (m) {
    return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}T${m[4].padStart(2, '0')}:${m[5]}:${m[6]}`;
  }
  // AppSheet 12-hr format: MM/DD/YYYY HH:MM AM/PM
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (m) {
    let h = parseInt(m[4], 10);
    const isPM = m[6].toUpperCase() === 'PM';
    if (isPM && h < 12) h += 12;
    if (!isPM && h === 12) h = 0;
    return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}T${String(h).padStart(2, '0')}:${m[5]}:00`;
  }
  // Date-only -> midnight
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}T00:00:00`;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function cleanValue(dbCol: string, raw: any): any {
  if (raw === null || raw === undefined) return null;
  const v = typeof raw === 'string' ? raw.trim() : String(raw).trim();
  if (!v) return null;
  if (config.date_fields?.includes(dbCol)) return toIsoDate(v);
  if (config.datetime_fields?.includes(dbCol)) return toIsoDateTime(v);
  return v;
}

// ── Fetch from AppSheet (with disk cache) ─────────────────────────────────────
async function fetchAppSheetTable(): Promise<any[]> {
  const cacheDir = resolve('scripts/.cache');
  mkdirSync(cacheDir, { recursive: true });
  const cachePath = resolve(cacheDir, `${tableName}.json`);

  if (!refetch && existsSync(cachePath)) {
    const stat = (await import('fs')).statSync(cachePath);
    const ageMin = (Date.now() - stat.mtimeMs) / 1000 / 60;
    if (ageMin < 60) {
      console.log(`Using cached AppSheet response (${ageMin.toFixed(1)} min old, ${cachePath})`);
      console.log(`  Pass --refetch to force re-download.`);
      return JSON.parse(readFileSync(cachePath, 'utf-8'));
    }
  }

  console.log(`Fetching "${config.appsheet_table}" from AppSheet API...`);
  const url = `https://www.appsheet.com/api/v2/apps/${APP_ID}/tables/${encodeURIComponent(config.appsheet_table)}/Action`;
  const body = {
    Action: 'Find',
    Properties: { Locale: 'en-US', Timezone: 'Mountain Standard Time' },
    Rows: [],
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ApplicationAccessKey: APPSHEET_KEY!,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`AppSheet API ${res.status}: ${t.slice(0, 500)}`);
  }
  const arr = await res.json();
  if (!Array.isArray(arr)) {
    throw new Error(`Expected array from AppSheet, got: ${JSON.stringify(arr).slice(0, 300)}`);
  }
  writeFileSync(cachePath, JSON.stringify(arr, null, 0));
  console.log(`  Fetched ${arr.length} rows, cached at ${cachePath}`);
  return arr;
}

// ── FK lookups ────────────────────────────────────────────────────────────────
type FkMap = Map<string, string>;
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
  for (const dbCol of Object.keys(config.fk_resolution || {})) {
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
  for (const [col, mapping] of Object.entries(config.enum_normalize || {})) {
    const v = out[col];
    if (v && mapping[v]) out[col] = mapping[v];
  }
  return out;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${'═'.repeat(72)}`);
  console.log(`AppSheet API → Supabase importer`);
  console.log(`${'═'.repeat(72)}`);
  console.log(`Supabase table:  ${config.table}`);
  console.log(`AppSheet table:  ${config.appsheet_table}`);
  console.log(`Mode:            ${config.mode}`);
  console.log(`Match on:        ${config.match_on}`);
  console.log(`Dry run:         ${dryRun}`);
  console.log(`Limit:           ${limit === Infinity ? 'all' : limit}`);
  console.log('');

  const records = await fetchAppSheetTable();
  console.log(`Got ${records.length} rows from AppSheet\n`);

  console.log(`Fetching existing rows from ${config.table}...`);
  const existing = await fetchAll(config.table, '*');
  const existingByKey = new Map<string, any>();
  for (const r of existing) {
    const k = r[config.match_on];
    if (k !== undefined && k !== null) existingByKey.set(String(k).trim(), r);
  }
  console.log(`Found ${existing.length} existing rows (indexed by ${config.match_on})\n`);

  if (config.fk_resolution && Object.keys(config.fk_resolution).length) {
    console.log('Loading FK lookups...');
    await loadFkLookups();
    console.log('');
  }

  let inserted = 0,
    updated = 0,
    noChange = 0,
    skipped = 0,
    errors = 0,
    processed = 0;

  for (const row of records) {
    if (processed >= limit) break;
    // Build payload by walking the column_map
    const fromApp: Record<string, any> = {};
    for (const [appsheetCol, dbCol] of Object.entries(config.column_map)) {
      const raw = row[appsheetCol];
      fromApp[dbCol] = cleanValue(dbCol, raw);
    }
    // The AppSheet "Row ID" field becomes Supabase row_id
    if (row['Row ID'] && !fromApp.row_id) fromApp.row_id = String(row['Row ID']).trim();

    const keyVal = fromApp[config.match_on];
    if (!keyVal) {
      skipped++;
      continue;
    }
    processed++;

    const resolved = resolveFks(fromApp);
    const existingRow = existingByKey.get(String(keyVal).trim());
    const isNew = !existingRow;
    const label = `[${processed}] ${config.match_on}=${keyVal}`;

    if (isNew) {
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
    } else {
      let payload: Record<string, any> = {};
      if (config.mode === 'full-overwrite') {
        for (const dbCol of Object.values(config.column_map)) {
          if (dbCol in resolved) payload[dbCol] = resolved[dbCol];
        }
      } else {
        // preserve-edits
        for (const [k, v] of Object.entries(resolved)) {
          if (k === config.match_on) continue;
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
