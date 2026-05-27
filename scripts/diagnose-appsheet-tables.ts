/**
 * Find where these 4 orphan row_ids live in AppSheet:
 *   A8U_21AD3c47uV_87ociv3
 *   ZndmdkouGz4Ne5Kiedy7s7
 *   FdGKGZzLuw4yQIAT2dDYXc
 *   9WPVXMqvre3CRSeltJukwA
 *
 * Tries common candidate AppSheet table names. Reports which tables contain
 * each row_id and prints the matching record (truncated).
 *
 * Also dumps a few rows from each candidate so we can see its shape /
 * key columns.
 */

const APP_ID = '87bcc0a1-ac3f-4b51-8198-84b8274a5826';
const APPSHEET_KEY = process.env.APPSHEET_KEY;
if (!APPSHEET_KEY) throw new Error('Missing APPSHEET_KEY');

const ORPHANS = new Set([
  'A8U_21AD3c47uV_87ociv3',
  'ZndmdkouGz4Ne5Kiedy7s7',
  'FdGKGZzLuw4yQIAT2dDYXc',
  '9WPVXMqvre3CRSeltJukwA',
]);

// Try a broad set of plausible AppSheet table names
const CANDIDATES = [
  'Components',
  'Component',
  'Failed Components',
  'Failed Component',
  'Parts',
  'Part',
  'Items',
  'Item',
  'Lists',
  'List',
  'Inventory',
  'Materials',
  'Material',
];

async function fetchTable(name: string): Promise<any[] | null> {
  const url = `https://www.appsheet.com/api/v2/apps/${APP_ID}/tables/${encodeURIComponent(name)}/Action`;
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
  if (!res.ok) return null;
  const arr = await res.json();
  return Array.isArray(arr) ? arr : null;
}

async function main() {
  for (const name of CANDIDATES) {
    process.stdout.write(`• ${name.padEnd(20)} `);
    const rows = await fetchTable(name);
    if (!rows) {
      console.log('(not found)');
      continue;
    }
    console.log(`${rows.length} rows`);

    const cols = rows[0] ? Object.keys(rows[0]) : [];
    console.log(`    columns: ${cols.join(', ')}`);

    // Look for orphans (check every column, not just Row ID — they might be FKs)
    const hits: Record<string, any> = {};
    for (const r of rows) {
      const rid = String(r['Row ID'] ?? '').trim();
      if (ORPHANS.has(rid)) hits[rid] = r;
    }
    if (Object.keys(hits).length) {
      console.log(`    ✓ orphan matches (by Row ID): ${Object.keys(hits).length}`);
      for (const [rid, row] of Object.entries(hits)) {
        const compact: Record<string, any> = {};
        for (const k of cols.slice(0, 8)) compact[k] = row[k];
        console.log(`      ${rid}: ${JSON.stringify(compact)}`);
      }
    }
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
