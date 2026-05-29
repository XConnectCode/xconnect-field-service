import assert from 'node:assert';
import {
  looksLikeRowId,
  resolveFailedComponentLabel,
  resolveFailureTypeLabel,
} from './failedComponent';

// ── looksLikeRowId ───────────────────────────────────────────────────────────
assert.strictEqual(looksLikeRowId('zMZ20AuctS4jiOrtVD-7Qd'), true);
assert.strictEqual(looksLikeRowId('Bottom End Plate'), false);
assert.strictEqual(looksLikeRowId('XC2.75 Standard Bottom End Plate'), false);
assert.strictEqual(looksLikeRowId('cb6f3d7e-7c4d-4b8c-9b8a-1234567890ab'), true);
assert.strictEqual(looksLikeRowId('538cb682-3f7c-47b5-a5d7-3a5c9fc484e0'), true);
assert.strictEqual(looksLikeRowId(''), false);
assert.strictEqual(looksLikeRowId('   '), false);
// short tokens like "N/A" or "TBD" are not row_ids
assert.strictEqual(looksLikeRowId('TBD'), false);
assert.strictEqual(looksLikeRowId('Connector'), false);

// ── resolveFailedComponentLabel ──────────────────────────────────────────────
// Authoritative source: components table only.
const componentsMap = {
  // The exact Incident #572 case, verified against the live DB.
  'zMZ20AuctS4jiOrtVD-7Qd': { failed_component: 'XC2.75 Standard Bottom End Plate' },
  'comp-row-1': { failed_component: 'Charge Tube' },
};

assert.strictEqual(
  resolveFailedComponentLabel('zMZ20AuctS4jiOrtVD-7Qd', componentsMap),
  'XC2.75 Standard Bottom End Plate',
);

assert.strictEqual(
  resolveFailedComponentLabel('comp-row-1', componentsMap),
  'Charge Tube',
);

// Unknown row_id-looking value: returns fallback (NEVER the raw id)
assert.strictEqual(
  resolveFailedComponentLabel('unknownABCDEFGHIJKLMNOP', componentsMap),
  '—',
);

// Human label passed through verbatim (legacy free-text)
assert.strictEqual(
  resolveFailedComponentLabel('Some Loose Wire', componentsMap),
  'Some Loose Wire',
);

// Null/empty input
assert.strictEqual(resolveFailedComponentLabel(null, componentsMap), '—');
assert.strictEqual(resolveFailedComponentLabel('', componentsMap), '—');
assert.strictEqual(resolveFailedComponentLabel('   ', componentsMap), '—');

// Custom fallback honored
assert.strictEqual(
  resolveFailedComponentLabel(null, componentsMap, 'N/A'),
  'N/A',
);

// Missing/empty componentsMap still returns fallback rather than the raw id
assert.strictEqual(
  resolveFailedComponentLabel('zMZ20AuctS4jiOrtVD-7Qd', {}),
  '—',
);
assert.strictEqual(
  resolveFailedComponentLabel('zMZ20AuctS4jiOrtVD-7Qd', null),
  '—',
);

// ── resolveFailureTypeLabel ──────────────────────────────────────────────────
// Authoritative source: lists table only.
const listMap = {
  '538cb682-3f7c-47b5-a5d7-3a5c9fc484e0': {
    failed_component: null,
    failure_type: 'Mechanical',
  },
};

assert.strictEqual(
  resolveFailureTypeLabel('538cb682-3f7c-47b5-a5d7-3a5c9fc484e0', listMap),
  'Mechanical',
);

// Unknown id-looking value: fallback, NEVER the raw id
assert.strictEqual(
  resolveFailureTypeLabel('zMZ20AuctS4jiOrtVD-7Qd', listMap),
  '—',
);

// Plain text passes through
assert.strictEqual(
  resolveFailureTypeLabel('Electrical Short', listMap),
  'Electrical Short',
);

console.log('failedComponent tests passed');
