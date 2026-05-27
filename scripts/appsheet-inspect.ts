/**
 * Inspect raw AppSheet API responses for a few tables — useful for figuring out
 * whether reference columns come back as Row IDs or display names.
 *
 * Usage:
 *   export APPSHEET_KEY=$(cat ~/.appsheet-key)
 *   pnpm tsx scripts/appsheet-inspect.ts
 */

const APP_ID = '87bcc0a1-ac3f-4b51-8198-84b8274a5826';
const KEY = process.env.APPSHEET_KEY!;
if (!KEY) {
  console.error('Missing APPSHEET_KEY');
  process.exit(1);
}

const TABLES = ['Customer Districts', 'Field Visits', 'Panels', 'Incident'];

async function fetchTable(name: string) {
  const url = `https://www.appsheet.com/api/v2/apps/${APP_ID}/tables/${encodeURIComponent(name)}/Action`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ApplicationAccessKey: KEY },
    body: JSON.stringify({
      Action: 'Find',
      Properties: { Locale: 'en-US', Timezone: 'Mountain Standard Time' },
      Rows: [],
    }),
  });
  if (!res.ok) {
    console.log(`${name}: HTTP ${res.status}`);
    return;
  }
  const arr = await res.json();
  console.log(`\n══════ ${name} (${arr.length} rows) ══════`);
  if (arr[0]) {
    console.log('All columns + first-row values:');
    for (const [k, v] of Object.entries(arr[0])) {
      const s = typeof v === 'string' ? v.slice(0, 80) : String(v);
      console.log(`  ${k.padEnd(40)} = ${s}`);
    }
  }
}

(async () => {
  for (const t of TABLES) await fetchTable(t);
})();
