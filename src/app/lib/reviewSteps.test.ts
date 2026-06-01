import { getReviewSteps } from './incidentWorkflow';

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; }
  else console.log('ok:', msg);
}

// A fully-populated XC-caused incident (all required fields present).
// xc_caused = 'Yes' → report generate + send steps apply.
// Steps for this incident: [fields, review, generate, sent, closed]  (5 steps)
const completeXC = {
  xc_caused: 'Yes',
  vendor_caused: 'No',
  failed_component: 'comp1',
  event_category: 'Cat',
  failure_type: 'ft1',
  product_line: 'PL',
  root_cause: 'because reasons',
};

// A fully-populated NON-XC incident (xc_caused = 'No').
// No report steps → sequence is [fields, review, closed]  (3 steps).
const completeNonXC = { ...completeXC, xc_caused: 'No' };

// Helper to find a step by id (indices shift between XC / non-XC incidents).
function step(steps: ReturnType<typeof getReviewSteps>, id: string) {
  const s = steps.find(x => x.id === id);
  if (!s) throw new Error(`step ${id} not found`);
  return s;
}

// ── XC-caused incident: 5-step sequence ──────────────────────────────────────

// 1) Empty incident as admin: only fields actionable, everything else blocked.
{
  const steps = getReviewSteps({ xc_caused: 'Yes' }, 'admin');
  assert(steps.length === 5, 'XC empty: 5 steps (fields/review/generate/sent/closed)');
  assert(steps.map(s => s.id).join(',') === 'fields,review,generate,sent,closed', 'XC empty: step order');
  const fields = step(steps, 'fields');
  assert(!fields.done && fields.actionable, 'XC empty: fields actionable');
  assert(fields.missing.length > 0, 'XC empty: fields lists missing');
  assert(!step(steps, 'review').actionable && step(steps, 'review').blockedReason.includes('required fields'), 'XC empty: review blocked on fields');
  assert(!step(steps, 'generate').actionable, 'XC empty: generate blocked');
  assert(!step(steps, 'sent').actionable, 'XC empty: sent blocked');
  assert(!step(steps, 'closed').actionable, 'XC empty: close blocked');
}

// 2) Fields complete, not reviewed (admin): review actionable; generate/sent/close blocked.
{
  const steps = getReviewSteps(completeXC, 'admin');
  assert(step(steps, 'fields').done, 'XC complete: fields done');
  assert(step(steps, 'review').actionable && !step(steps, 'review').done, 'XC complete: review actionable');
  assert(!step(steps, 'generate').actionable && step(steps, 'generate').blockedReason.includes('review'), 'XC complete: generate blocked on review');
  assert(!step(steps, 'sent').actionable, 'XC complete: sent blocked');
  assert(!step(steps, 'closed').actionable, 'XC complete: close blocked');
}

// 3) Fields + reviewed, no report yet (admin): generate actionable; sent/close blocked.
{
  const inc = { ...completeXC, reviewed_at: '2026-05-31T00:00:00Z', reviewed_by: 'Dir' };
  const steps = getReviewSteps(inc, 'admin');
  assert(step(steps, 'review').done, 'XC reviewed: review done');
  assert(step(steps, 'generate').actionable && !step(steps, 'generate').done, 'XC reviewed: generate actionable');
  assert(!step(steps, 'sent').actionable && step(steps, 'sent').blockedReason.includes('Generate'), 'XC reviewed: sent blocked on generate');
  assert(!step(steps, 'closed').actionable && step(steps, 'closed').blockedReason.includes('Generate'), 'XC reviewed: close blocked on generate');
}

// 4) Fields + reviewed + generated, not sent (admin): sent actionable; close blocked on sent.
{
  const inc = { ...completeXC, reviewed_at: 'x', report_generated_at: '2026-05-31T00:30:00Z' };
  const steps = getReviewSteps(inc, 'admin');
  assert(step(steps, 'generate').done, 'XC generated: generate done');
  assert(step(steps, 'sent').actionable && !step(steps, 'sent').done, 'XC generated: sent actionable');
  assert(!step(steps, 'closed').actionable && step(steps, 'closed').blockedReason.includes('Send'), 'XC generated: close blocked on sent');
}

// 5) Fields + reviewed + generated + sent (admin): close actionable.
{
  const inc = { ...completeXC, reviewed_at: 'x', report_generated_at: 'x', report_sent: '2026-05-31T01:00:00Z' };
  const steps = getReviewSteps(inc, 'admin');
  assert(step(steps, 'sent').done, 'XC sent: sent done');
  assert(step(steps, 'closed').actionable && !step(steps, 'closed').done, 'XC sent: close actionable');
}

// 6) Closed XC incident: all done.
{
  const inc = { ...completeXC, reviewed_at: 'x', report_generated_at: 'x', report_sent: 'x', incident_status: 'Closed' };
  const steps = getReviewSteps(inc, 'admin');
  assert(steps.every(s => s.done), 'XC closed: all steps done');
}

// 7) Role gating (XC): SQM can complete fields but not review/generate/send/close.
{
  const steps = getReviewSteps(completeXC, 'sqm');
  assert(step(steps, 'fields').allowedForRole, 'XC sqm: allowed to complete fields');
  assert(!step(steps, 'review').allowedForRole, 'XC sqm: not allowed to review');
  assert(!step(steps, 'generate').allowedForRole, 'XC sqm: not allowed to generate');
  assert(!step(steps, 'sent').allowedForRole, 'XC sqm: not allowed to send');
  assert(!step(steps, 'closed').allowedForRole, 'XC sqm: not allowed to close');
}

// ── Non-XC incident: 3-step sequence (no report steps) ───────────────────────

// 8) Non-XC incident skips generate + sent entirely.
{
  const steps = getReviewSteps(completeNonXC, 'admin');
  assert(steps.length === 3, 'nonXC: 3 steps (fields/review/closed)');
  assert(steps.map(s => s.id).join(',') === 'fields,review,closed', 'nonXC: step order, no report steps');
  assert(!steps.some(s => s.id === 'generate'), 'nonXC: no generate step');
  assert(!steps.some(s => s.id === 'sent'), 'nonXC: no sent step');
}

// 9) Non-XC: fields + reviewed → close actionable immediately (no report gate).
{
  const inc = { ...completeNonXC, reviewed_at: 'x' };
  const steps = getReviewSteps(inc, 'admin');
  assert(step(steps, 'review').done, 'nonXC reviewed: review done');
  assert(step(steps, 'closed').actionable && !step(steps, 'closed').done, 'nonXC reviewed: close actionable right after review');
}

// 10) Non-XC: fields complete, not reviewed → close blocked on review (not on a report).
{
  const steps = getReviewSteps(completeNonXC, 'admin');
  assert(!step(steps, 'closed').actionable && step(steps, 'closed').blockedReason.includes('review'), 'nonXC: close blocked on review');
}

// 11) Inconclusive is treated like XC-caused (report required).
{
  const inc = { ...completeXC, xc_caused: 'Inconclusive' };
  const steps = getReviewSteps(inc, 'admin');
  assert(steps.length === 5, 'inconclusive: 5 steps (report required)');
  assert(steps.some(s => s.id === 'generate') && steps.some(s => s.id === 'sent'), 'inconclusive: has generate + sent steps');
}

console.log('done');
