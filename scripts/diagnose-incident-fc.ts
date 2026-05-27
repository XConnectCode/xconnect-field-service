/**
 * Diagnose the 6 incidents that failed insert with
 * "violates foreign key constraint fk_incidents_failed_component_lists".
 *
 * For each failed row_id:
 *   - Print the AppSheet "Failed Component" value
 *   - Check if it matches a lists.failed_component (case-insensitive) -> we just need
 *     to add fk_resolution and rerun
 *   - If not, surface the unknown value(s) so the user can decide:
 *       insert into lists, or null out failed_component
 *
 * Run:
 *   pnpm tsx scripts/diagnose-incident-fc.ts
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const APP_ID = '87bcc0a1-ac3f-4b51-8198-84b8274a5826';
const APPSHEET_KEY = process.env.APPSHEET_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!APPSHEET_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error('Missing env: APPSHEET_KEY / SUPABASE_URL / SUPABASE_SERVICE_KEY');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const FAILED_IDS = [
  '3NOyIu6cev4XaPoYkNHTqd',
  'IOj56dH4JI4rakp_rFSID7',
  'JGNeCw8Rub4EYA3vnCFZyf',
  'VDODVOTHAt4uQOgoCiq-Cf',
  '05yRxaSZkkSg0ZynETdDdH',
  'faEEprffI23O8z1QLCD9mC',
];

async function loadIncidents(): Promise<any[]> {
  // Prefer cache (1-hour TTL) to avoid hitting AppSheet again
  const cachePath = resolve('scripts/.cache/incidents.json');
  if (existsSync(cachePath)) {
    console.log(`Using cached incidents at ${cachePath}`);
    return JSON.parse(readFileSync(cachePath, 'utf-8'));
  }
  console.log('Cache miss — fetching incidents from AppSheet...');
  const url = `https://www.appsheet.com/api/v2/apps/${APP_ID}/tables/${encodeURIComponent('Incident')}/Action`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ApplicationAccessKey: APPSHEET_KEY!,
    },
    body: JSON.stringify({
      Action: 'Find',
      Properties: { Locale: 'en-US', Timezone: 'Mountain Standard Time' },
      Rows: [],
    }),
  });
  if (!res.ok) throw new Error(`AppSheet ${res.status}: ${await res.text()}`);
  return res.json();
}

async function main() {
  console.log('Loading incidents...');
  const incidents = await loadIncidents();
  console.log(`  ${incidents.length} rows\n`);

  console.log('Loading lists.failed_component map...');
  const { data: lists, error } = await supabase
    .from('lists')
    .select('row_id, failed_component')
    .not('failed_component', 'is', null);
  if (error) throw error;
  const byName = new Map<string, string>();
  const byNameLower = new Map<string, string>();
  for (const r of lists!) {
    const k = String(r.failed_component).trim();
    if (k) {
      byName.set(k, r.row_id);
      byNameLower.set(k.toLowerCase(), r.row_id);
    }
  }
  console.log(`  ${byName.size} components (${byNameLower.size} unique lowercase)\n`);

  console.log('─'.repeat(72));
  console.log('Per failed incident:');
  console.log('─'.repeat(72));

  const unknownValues = new Set<string>();

  for (const rid of FAILED_IDS) {
    const inc = incidents.find((r: any) => String(r['Row ID']).trim() === rid);
    if (!inc) {
      console.log(`\n✗ ${rid}: NOT FOUND in AppSheet response`);
      continue;
    }
    const fc = inc['Failed Component'];
    const fcStr = fc == null ? '<null>' : String(fc).trim();
    console.log(`\n${rid}`);
    console.log(`  Failed Component (raw): ${JSON.stringify(fc)}`);
    console.log(`  Event ID:               ${inc['Event ID']}`);
    console.log(`  Date of Incident:       ${inc['Date of Incident']}`);
    console.log(`  Customer:               ${inc['Customer']}`);

    if (!fcStr || fcStr === '<null>') {
      console.log('  → empty: would pass FK as null. Not the offender.');
      continue;
    }

    // Maybe AppSheet returns row_id directly?
    const isLikelyRowId = /^[A-Za-z0-9_-]{20,}$/.test(fcStr) || /^[0-9a-f-]{36}$/.test(fcStr);
    if (isLikelyRowId) {
      const { data: hit } = await supabase
        .from('lists')
        .select('row_id, failed_component')
        .eq('row_id', fcStr)
        .maybeSingle();
      if (hit) {
        console.log(`  → row_id match: lists.row_id=${hit.row_id} ("${hit.failed_component}")`);
        continue;
      }
      console.log(`  → looks like row_id but NOT in lists`);
      unknownValues.add(fcStr);
      continue;
    }

    // Name lookup
    const exact = byName.get(fcStr);
    if (exact) {
      console.log(`  → name match (exact): lists.row_id=${exact}`);
      continue;
    }
    const ci = byNameLower.get(fcStr.toLowerCase());
    if (ci) {
      console.log(`  → name match (case-insensitive): lists.row_id=${ci}`);
      continue;
    }
    console.log(`  → NO MATCH in lists for "${fcStr}"`);
    unknownValues.add(fcStr);
  }

  if (unknownValues.size) {
    console.log('\n' + '─'.repeat(72));
    console.log(`Unknown Failed Component values (${unknownValues.size}):`);
    console.log('─'.repeat(72));
    for (const v of [...unknownValues].sort()) console.log(`  - ${v}`);
    console.log('\nFix options:');
    console.log('  A) Add fk_resolution { failed_component: { table: lists, match: failed_component, return: row_id } }');
    console.log('     -> unknown values will be stored as null, FK passes');
    console.log('  B) Insert missing components into lists first, then add fk_resolution');
  } else {
    console.log('\n✓ All 6 values exist in lists. Just add fk_resolution and rerun.');
  }
}

main().catch((err) => {
  console.error('\n✗ Fatal:', err);
  process.exit(1);
});
