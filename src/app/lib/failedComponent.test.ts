import assert from 'node:assert';
import {
  looksLikeRowId,
  resolveFailedComponentLabel,
  resolveFailureTypeLabel,
} from './failedComponent';

// ── looksLikeRowId ───────────────────────────────────────────────────────────
assert.strictEqual(looksLikeRowId('zMZ20AuctS4jiOrtVD-7Qd'), true);
assert.strictEqual(looksLikeRowId('Bottom End Plate'), false);
assert.strictEqual(looksLikeRowId('Charge Tube'), false);
assert.strictEqual(looksLikeRowId('cb6f3d7e-7c4d-4b8c-9b8a-1234567890ab'), true);
assert.strictEqual(looksLikeRowId(''), false);
assert.strictEqual(looksLikeRowId('   '), false);
// short tokens like "N/A" or "TBD" are not row_ids
assert.strictEqual(looksLikeRowId('TBD'), false);
// single-word labels still possible if short
assert.strictEqual(looksLikeRowId('Connector'), false);

// ── resolveFailedComponentLabel ──────────────────────────────────────────────
const listMap = {
  'list-row-1': { failed_component: 'Bottom End Plate', failure_type: null },
  'list-row-2': { failed_component: null, failure_type: 'Mechanical' },
};
const componentsMap = {
  'comp-row-1': { failed_component: 'Charge Tube' },
  'zMZ20AuctS4jiOrtVD-7Qd': { failed_component: 'Bottom End Plate' },
};

// Resolves through `lists`
assert.strictEqual(
  resolveFailedComponentLabel('list-row-1', listMap, componentsMap),
  'Bottom End Plate',
);

// Falls back to `components` when not in lists
assert.strictEqual(
  resolveFailedComponentLabel('comp-row-1', listMap, componentsMap),
  'Charge Tube',
);

// Resolves the exact bug-572 case (components.row_id, not in lists)
assert.strictEqual(
  resolveFailedComponentLabel('zMZ20AuctS4jiOrtVD-7Qd', listMap, componentsMap),
  'Bottom End Plate',
);

// Unknown row_id-looking value: returns fallback (NOT the raw id)
assert.strictEqual(
  resolveFailedComponentLabel('unknownABCDEFGHIJKLMNOP', listMap, componentsMap),
  '—',
);

// Human label passed through verbatim (legacy free-text)
assert.strictEqual(
  resolveFailedComponentLabel('Some Loose Wire', listMap, componentsMap),
  'Some Loose Wire',
);

// Null/empty input
assert.strictEqual(resolveFailedComponentLabel(null, listMap, componentsMap), '—');
assert.strictEqual(resolveFailedComponentLabel('', listMap, componentsMap), '—');
assert.strictEqual(resolveFailedComponentLabel('   ', listMap, componentsMap), '—');

// Custom fallback honored
assert.strictEqual(
  resolveFailedComponentLabel(null, listMap, componentsMap, 'N/A'),
  'N/A',
);

// Works without componentsMap
assert.strictEqual(
  resolveFailedComponentLabel('list-row-1', listMap),
  'Bottom End Plate',
);

// ── resolveFailureTypeLabel ──────────────────────────────────────────────────
assert.strictEqual(
  resolveFailureTypeLabel('list-row-2', listMap),
  'Mechanical',
);

// Unknown id-looking value: fallback, NOT raw id
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
