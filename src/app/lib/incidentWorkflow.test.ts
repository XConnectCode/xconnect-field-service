import assert from 'node:assert';
import {
  ACTION_STATUSES,
  ACTION_STATUS_COMPLETE,
  ACTION_STATUS_LABELS,
  normalizeActionStatus,
  isActionStatusComplete,
  findStatusInconsistencies,
  CLOSED_STATUS,
} from './incidentWorkflow';

// ── DB CHECK constraint surface ──────────────────────────────────────────────
// The Postgres CHECK on `incidents.action_status` is:
//   CHECK (action_status = ANY (ARRAY['Open','In Progress','Complete']))
// Anything other than these three literals raises
// `incidents_action_status_check` and the upsert is rejected.

assert.deepStrictEqual(ACTION_STATUSES, ['Open', 'In Progress', 'Complete']);
assert.strictEqual(ACTION_STATUS_COMPLETE, 'Complete');
// The friendly UI label for the terminal state is "Completed" but the
// stored DB literal must be "Complete" (no trailing 'd').
assert.strictEqual(ACTION_STATUS_LABELS.Complete, 'Completed');
assert.strictEqual(ACTION_STATUS_COMPLETE.endsWith('d'), false);

// ── normalizeActionStatus ────────────────────────────────────────────────────
assert.strictEqual(normalizeActionStatus('Open'), 'Open');
assert.strictEqual(normalizeActionStatus('In Progress'), 'In Progress');
assert.strictEqual(normalizeActionStatus('Complete'), 'Complete');
// The bug: code was writing "Completed" — normalize must coerce it back.
assert.strictEqual(normalizeActionStatus('Completed'), 'Complete');
assert.strictEqual(normalizeActionStatus('completed'), 'Complete');
assert.strictEqual(normalizeActionStatus('Done'), 'Complete');
assert.strictEqual(normalizeActionStatus('Closed'), 'Complete');
assert.strictEqual(normalizeActionStatus('in-progress'), 'In Progress');
assert.strictEqual(normalizeActionStatus('Pending'), 'In Progress');
assert.strictEqual(normalizeActionStatus(''), null);
assert.strictEqual(normalizeActionStatus(null), null);
assert.strictEqual(normalizeActionStatus(undefined), null);
// Unknown values fall through to null so the caller drops the field
// rather than persisting something the DB will reject.
assert.strictEqual(normalizeActionStatus('something-else'), null);

// ── isActionStatusComplete ───────────────────────────────────────────────────
assert.strictEqual(isActionStatusComplete('Complete'), true);
assert.strictEqual(isActionStatusComplete('Completed'), true);
assert.strictEqual(isActionStatusComplete('Done'), true);
assert.strictEqual(isActionStatusComplete('In Progress'), false);
assert.strictEqual(isActionStatusComplete('Open'), false);
assert.strictEqual(isActionStatusComplete(null), false);

// ── findStatusInconsistencies ────────────────────────────────────────────────
// Closed incident with in-progress action → inconsistency reported.
assert.deepStrictEqual(
  findStatusInconsistencies({ incident_status: 'Closed', action_status: 'In Progress' }).length,
  1,
);
// Closed incident with Complete action → no inconsistency.
assert.deepStrictEqual(
  findStatusInconsistencies({ incident_status: 'Closed', action_status: 'Complete' }),
  [],
);
// Closed incident with the (incorrect, persisted) "Completed" string → also
// counted as consistent because normalize coerces it to Complete.
assert.deepStrictEqual(
  findStatusInconsistencies({ incident_status: 'Closed', action_status: 'Completed' }),
  [],
);
// Non-closed incident → no constraints.
assert.deepStrictEqual(
  findStatusInconsistencies({ incident_status: 'Investigating', action_status: 'In Progress' }),
  [],
);

// ── End-to-end: persisting a closed incident must use the literal 'Complete'
//   This mirrors what IncidentForm's handleSubmit and Dashboard's QuickEdit
//   build for the Supabase update payload.
function buildPayload(targetIncidentStatus: string, rawAction: string | null): { incident_status: string; action_status: string | null } {
  const incidentStatus = targetIncidentStatus;
  const action = incidentStatus === CLOSED_STATUS
    ? ACTION_STATUS_COMPLETE
    : normalizeActionStatus(rawAction);
  return { incident_status: incidentStatus, action_status: action };
}

// Closing an incident → action_status MUST be the literal 'Complete'.
const p1 = buildPayload('Closed', 'In Progress');
assert.strictEqual(p1.action_status, 'Complete');
// Bug case: user picked "Completed" in the legacy dropdown → it lands as 'Complete'.
const p2 = buildPayload('Investigating', 'Completed');
assert.strictEqual(p2.action_status, 'Complete');
// In-progress investigation persists 'In Progress'.
const p3 = buildPayload('Investigating', 'In Progress');
assert.strictEqual(p3.action_status, 'In Progress');
// No action_status selected → null persisted (DB column is nullable).
const p4 = buildPayload('Investigating', null);
assert.strictEqual(p4.action_status, null);
// Crucially: none of the payloads carry the forbidden 'Completed' literal.
for (const p of [p1, p2, p3, p4]) {
  assert.notStrictEqual(p.action_status, 'Completed');
}

console.log('incidentWorkflow tests passed');
