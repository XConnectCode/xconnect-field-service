import assert from 'node:assert';
import {
  buildStorageMarker,
  isStorageMarker,
  pickReport,
  reportTypeFor,
  sanitizeEventId,
  STORAGE_URL_SCHEME,
  INCIDENT_REPORTS_BUCKET,
  type IncidentReportRow,
} from './incidentReportStorage.core';

// buildStorageMarker / isStorageMarker
const path = 'EVT123/final-1700000000000.pdf';
const marker = buildStorageMarker(path);
assert.strictEqual(marker, `${STORAGE_URL_SCHEME}${INCIDENT_REPORTS_BUCKET}/${path}`);
assert.strictEqual(isStorageMarker(marker), true);
assert.strictEqual(isStorageMarker('https://example.com/foo.pdf'), false);
assert.strictEqual(isStorageMarker(null), false);
assert.strictEqual(isStorageMarker(undefined), false);
assert.strictEqual(isStorageMarker(''), false);

// reportTypeFor / sanitizeEventId
assert.strictEqual(reportTypeFor('preliminary'), 'Preliminary');
assert.strictEqual(reportTypeFor('final'), 'Final');
assert.strictEqual(sanitizeEventId('EVT/123 abc!'), 'EVT_123_abc_');
assert.strictEqual(sanitizeEventId('safe-id_42'), 'safe-id_42');

// Insert-payload shape (simulates what uploadIncidentReport will write).
// Important: file_url is the storage marker, NOT null — that's what fixes
// the NOT NULL constraint violation on the legacy file_url column.
const insertPayload = {
  event_id: 'EVT1',
  report_type: reportTypeFor('final'),
  file_path: 'EVT1/final-1.pdf',
  file_url: buildStorageMarker('EVT1/final-1.pdf'),
  file_name: 'Event_EVT1_Final.pdf',
  generated_by: null,
  generated_at: new Date().toISOString(),
};
assert.ok(insertPayload.file_url, 'insert payload must populate file_url');
assert.strictEqual(insertPayload.file_url, 'storage://incident-reports/EVT1/final-1.pdf');
assert.strictEqual(isStorageMarker(insertPayload.file_url), true);

// pickReport finds the matching report_type
const rows: IncidentReportRow[] = [
  {
    row_id: '1',
    event_id: 'EVT1',
    report_type: 'Preliminary',
    file_url: buildStorageMarker('EVT1/preliminary-1.pdf'),
    file_path: 'EVT1/preliminary-1.pdf',
    file_name: 'Event_EVT1_Preliminary.pdf',
    generated_at: null,
    generated_by: null,
  },
  {
    row_id: '2',
    event_id: 'EVT1',
    report_type: 'Final',
    file_url: 'https://legacy.example.com/EVT1.pdf',
    file_path: null,
    file_name: 'Event_EVT1_Final.pdf',
    generated_at: null,
    generated_by: null,
  },
];

assert.strictEqual(pickReport(rows, 'preliminary')?.row_id, '1');
assert.strictEqual(pickReport(rows, 'final')?.row_id, '2');
assert.strictEqual(pickReport([], 'preliminary'), undefined);
assert.strictEqual(pickReport(undefined, 'final'), undefined);

// Legacy AppSheet rows keep their real public URL — not a marker.
assert.strictEqual(isStorageMarker(rows[1].file_url), false);

// pickReport('final') falls back to a migrated 'AppSheet Original' row when
// no app-generated Final exists, so native reports surface in the main slot.
const appsheetRows: IncidentReportRow[] = [
  {
    row_id: '10',
    event_id: 'EVT9',
    report_type: 'AppSheet Original',
    file_url: buildStorageMarker('EVT9/appsheet-123456.pdf'),
    file_path: 'EVT9/appsheet-123456.pdf',
    file_name: 'Event_EVT9_AppSheet_Original.pdf',
    generated_at: null,
    generated_by: null,
  },
];
assert.strictEqual(
  pickReport(appsheetRows, 'final')?.row_id,
  '10',
  "final should fall back to AppSheet Original",
);
// Preliminary does NOT fall back to AppSheet Original.
assert.strictEqual(pickReport(appsheetRows, 'preliminary'), undefined);
// A real Final still wins over an AppSheet Original when both are present.
const mixed: IncidentReportRow[] = [...appsheetRows, rows[1]];
assert.strictEqual(
  pickReport(mixed, 'final')?.row_id,
  '2',
  "a real Final should take precedence over AppSheet Original",
);

console.log('incidentReportStorage tests passed');
