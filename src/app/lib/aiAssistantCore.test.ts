import assert from 'node:assert';
import {
  ASSISTANT_FIELDS,
  buildReviewUserMessage,
  parseFindings,
  polishSystemPrompt,
  expandSystemPrompt,
  customerRewriteSystemPrompt,
  reviewSystemPrompt,
  severityRank,
  stripCodeFences,
  truncate,
} from './aiAssistantCore';

// ── ASSISTANT_FIELDS contract ────────────────────────────────────────────────
// The frontend renders selectors from this list, so any drift from the spec
// would silently drop a field from the panel.
assert.deepStrictEqual(
  [...ASSISTANT_FIELDS],
  [
    'incident_description',
    'investigation',
    'root_cause',
    'corrective_action',
    'preventive_action',
    'notes',
  ],
);

// ── System prompts include the field name ───────────────────────────────────
// Per-action prompts must scope themselves to the field being rewritten so
// the model never expands one field's text into another.
for (const f of ASSISTANT_FIELDS) {
  assert.ok(polishSystemPrompt(f).includes(f), `polish prompt missing ${f}`);
  assert.ok(expandSystemPrompt(f).includes(f), `expand prompt missing ${f}`);
  assert.ok(
    customerRewriteSystemPrompt(f).includes(f),
    `customer rewrite prompt missing ${f}`,
  );
}

// Polish must explicitly call out the real-world typos from the spec so a
// future prompt edit can't silently drop them.
assert.ok(polishSystemPrompt('investigation').includes('dissasembled'));
assert.ok(polishSystemPrompt('investigation').includes('mismaufactured'));

// Review prompt must enumerate every recurring problem class the spec asks
// us to catch. Drift here is exactly what produces silent regressions in
// production review quality.
const review = reviewSystemPrompt();
for (const phrase of [
  'Status contradictions',
  'Vague preventive',
  'Missing quantitative',
  'Symptom',
  'Spelling',
  'Placeholder',
]) {
  assert.ok(review.includes(phrase), `review prompt missing "${phrase}"`);
}

// ── buildReviewUserMessage ───────────────────────────────────────────────────
const sampleIncident = {
  incident_status: 'Final Review',
  action_status: 'Open',
  incident_description: 'Tool failed to fire on stage 4.',
  root_cause: 'TBD',
  corrective_action: '',
  notes: null,
};
const userMsg = buildReviewUserMessage(sampleIncident);
assert.ok(userMsg.includes('Final Review'));
assert.ok(userMsg.includes('Tool failed to fire on stage 4.'));
assert.ok(userMsg.includes('TBD'));
// Empty/null fields are omitted so the model doesn't waste tokens on blanks.
assert.ok(!userMsg.includes('--- Notes'));
assert.ok(!userMsg.includes('Corrective Action'));

// ── parseFindings: happy path ────────────────────────────────────────────────
const happy = parseFindings({
  findings: [
    {
      severity: 'high',
      field: 'preventive_action',
      issue: 'Vague',
      suggestion: 'Be specific',
    },
  ],
});
assert.strictEqual(happy.length, 1);
assert.strictEqual(happy[0].severity, 'high');

// ── parseFindings: tolerates string + code fence + bare array ───────────────
const fenced = `\`\`\`json
[
  {"severity":"medium","field":"root_cause","issue":"weak link","suggestion":"connect symptom"}
]
\`\`\``;
const fromFenced = parseFindings(fenced);
assert.strictEqual(fromFenced.length, 1);
assert.strictEqual(fromFenced[0].field, 'root_cause');

// Bare array (no wrapper object) — some providers do this.
const bare = parseFindings([
  { severity: 'LOW', field: 'notes', issue: 'typo', suggestion: 'fix' },
]);
assert.strictEqual(bare.length, 1);
assert.strictEqual(bare[0].severity, 'low');

// Alternate severity synonyms get coerced.
const synonyms = parseFindings({
  findings: [
    { severity: 'critical', field: 'a', issue: 'b', suggestion: 'c' },
    { severity: 'moderate', field: 'a', issue: 'b', suggestion: 'c' },
    { severity: 'info', field: 'a', issue: 'b', suggestion: 'c' },
  ],
});
assert.deepStrictEqual(
  synonyms.map((s) => s.severity),
  ['high', 'medium', 'low'],
);

// ── parseFindings: defensive against junk ───────────────────────────────────
assert.deepStrictEqual(parseFindings(null), []);
assert.deepStrictEqual(parseFindings('not json at all'), []);
assert.deepStrictEqual(parseFindings({}), []);
assert.deepStrictEqual(
  parseFindings({ findings: [{ severity: 'high' }] }), // missing issue/field
  [],
);
assert.deepStrictEqual(
  parseFindings({ findings: [{ severity: 'bogus', field: 'a', issue: 'b' }] }),
  [],
);

// suggestion is optional — must accept findings without one.
const noSuggestion = parseFindings({
  findings: [{ severity: 'low', field: 'notes', issue: 'typo' }],
});
assert.strictEqual(noSuggestion.length, 1);
assert.strictEqual(noSuggestion[0].suggestion, '');

// ── stripCodeFences ──────────────────────────────────────────────────────────
assert.strictEqual(stripCodeFences('```json\n{"a":1}\n```'), '{"a":1}');
assert.strictEqual(stripCodeFences('```\n{"a":1}\n```'), '{"a":1}');
assert.strictEqual(stripCodeFences('{"a":1}'), '{"a":1}');

// ── truncate ─────────────────────────────────────────────────────────────────
assert.strictEqual(truncate('hello', 100), 'hello');
assert.strictEqual(truncate('hello world', 5), 'hello');
// Non-string input must not throw — comes straight off the network.
assert.strictEqual(truncate(undefined as any, 5), '');

// ── severityRank ─────────────────────────────────────────────────────────────
assert.strictEqual(severityRank('high'), 0);
assert.strictEqual(severityRank('medium'), 1);
assert.strictEqual(severityRank('low'), 2);

console.log('aiAssistantCore tests passed.');
