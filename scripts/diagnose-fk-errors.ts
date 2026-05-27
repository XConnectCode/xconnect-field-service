/**
 * Quick post-import diagnostic.
 *
 * Run after import-from-appsheet.ts surfaced FK errors. This:
 *   1. Reads scripts/.cache/fieldvisits.json and scripts/.cache/districts.json
 *   2. Finds the 17 failed Field Visit row_ids and prints distinct Operating Company values
 *   3. Finds the duplicate-key District (YtFcZaJE6B4B6m6kA3Q_Zc) and compares against Supabase
 */
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error('Need SUPABASE_URL and SUPABASE_SERVICE_KEY env vars');
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── 1. Fieldvisits Operating Company FK errors ───────────────────────────────
const failedFvRowIds = [
  'E9SGYw0ertu3B8NMHE82HM','3vHQIxcUKf1lz6QuaMnXWR','O9RMcQeSmOWjahMsvgVNMJ',
  '1smtSC2t0Vw5FVgPlB6XvR','yG84niXL9J05UOhRKTm7s4','BLX0LcaxDLP0dWaanbCN1N',
  'eUQ0pjXw3neZVLdVQuzZlm','xRQvlZXyVuJwfFfTpxmgXt','hQcyg43nN3qxPcGbzGqX7O',
  'iZJVwiFC98hIsQXgGmIJnV','W5BH6yEJfB6FjfSZLOBTlw','K2FTYQxILIYqOVDaFKTdlE',
  'a99CUauMseq4WzTKXnjoZl','tOjnYvAfaqA5t17NzMrmHz','eaUejPI0yAXiJsCghKFF4f',
  'HWXLEZsYmUbOtBRJZnxjGk','2JDumYIDfpKGA7GkIaod6i',
];

const fvCache = JSON.parse(readFileSync('scripts/.cache/fieldvisits.json', 'utf-8'));
const opCounts = new Map<string, number>();
for (const r of fvCache) {
  if (failedFvRowIds.includes(r['Row ID'])) {
    const v = r['Operating Company'] ?? '(empty)';
    opCounts.set(v, (opCounts.get(v) || 0) + 1);
  }
}
console.log('\n── Fieldvisits: Operating Company values from the 17 failed rows ──');
for (const [v, n] of Array.from(opCounts.entries()).sort((a,b) => b[1]-a[1])) {
  console.log(`  ${n.toString().padStart(3)} × ${JSON.stringify(v)}`);
}

// Check which of those exist in ep table
console.log('\n── Cross-checking against ep.operating_company ──');
const { data: epRows, error: epErr } = await supabase.from('ep').select('operating_company').limit(1000);
if (epErr) throw new Error(epErr.message);
const epSet = new Set((epRows || []).map((r: any) => String(r.operating_company || '').trim()));
console.log(`  ep table has ${epSet.size} distinct operating_company values`);
for (const v of opCounts.keys()) {
  const present = epSet.has(String(v).trim());
  console.log(`  ${present ? '✓' : '✗ MISSING'}  ${JSON.stringify(v)}`);
}

// ── 2. Districts duplicate key error ──────────────────────────────────────────
console.log('\n── Districts: investigating duplicate row YtFcZaJE6B4B6m6kA3Q_Zc ──');
const distCache = JSON.parse(readFileSync('scripts/.cache/districts.json', 'utf-8'));
const appsheetDup = distCache.find((r: any) => r['Row ID'] === 'YtFcZaJE6B4B6m6kA3Q_Zc');
if (!appsheetDup) {
  console.log('  Could not find that row in AppSheet cache!');
} else {
  console.log('  AppSheet says:');
  console.log(`    Row ID:               ${appsheetDup['Row ID']}`);
  console.log(`    Customer District ID: ${appsheetDup['Customer District ID']}`);
  console.log(`    Customer District:    ${appsheetDup['Customer District']}`);

  const cdid = appsheetDup['Customer District ID'];
  const { data: db } = await supabase
    .from('districts')
    .select('row_id, customer_district_id, customer_district')
    .eq('customer_district_id', cdid);
  console.log(`\n  Supabase rows with customer_district_id="${cdid}":`);
  for (const r of db || []) {
    console.log(`    row_id=${r.row_id}  customer_district=${r.customer_district}`);
  }
}
console.log('');
