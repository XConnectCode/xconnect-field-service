import { getReviewSteps } from './incidentWorkflow';

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; }
  else console.log('ok:', msg);
}

// A fully-populated incident (all required fields present).
const complete = {
  xc_caused: 'Yes',
  vendor_caused: 'No',
  failed_component: 'comp1',
  event_category: 'Cat',
  failure_type: 'ft1',
  product_line: 'PL',
  root_cause: 'because reasons',
};

// 1) Empty incident as admin: only step 1 is actionable, rest blocked.
{
  const steps = getReviewSteps({}, 'admin');
  assert(steps[0].id === 'fields' && !steps[0].done && steps[0].actionable, 'empty: fields step actionable');
  assert(steps[0].missing.length > 0, 'empty: fields step lists missing');
  assert(!steps[1].actionable && steps[1].blockedReason.includes('required fields'), 'empty: review blocked on fields');
  assert(!steps[2].actionable, 'empty: sent blocked');
  assert(!steps[3].actionable, 'empty: close blocked');
}

// 2) Fields complete, not reviewed (admin): review becomes actionable, sent/close blocked.
{
  const steps = getReviewSteps(complete, 'admin');
  assert(steps[0].done, 'complete: fields done');
  assert(steps[1].actionable && !steps[1].done, 'complete: review actionable');
  assert(!steps[2].actionable && steps[2].blockedReason.includes('review'), 'complete: sent blocked on review');
  assert(!steps[3].actionable, 'complete: close blocked');
}

// 3) Fields + reviewed, not sent (admin): sent actionable, close blocked.
{
  const inc = { ...complete, reviewed_at: '2026-05-31T00:00:00Z', reviewed_by: 'Dir' };
  const steps = getReviewSteps(inc, 'admin');
  assert(steps[1].done, 'reviewed: review done');
  assert(steps[2].actionable && !steps[2].done, 'reviewed: sent actionable');
  assert(!steps[3].actionable && steps[3].blockedReason.includes('Send'), 'reviewed: close blocked on sent');
}

// 4) Fields + reviewed + sent (admin): close actionable.
{
  const inc = { ...complete, reviewed_at: 'x', report_sent: '2026-05-31T01:00:00Z' };
  const steps = getReviewSteps(inc, 'admin');
  assert(steps[2].done, 'sent: sent done');
  assert(steps[3].actionable && !steps[3].done, 'sent: close actionable');
}

// 5) Closed incident: all done.
{
  const inc = { ...complete, reviewed_at: 'x', report_sent: 'x', incident_status: 'Closed' };
  const steps = getReviewSteps(inc, 'admin');
  assert(steps.every(s => s.done), 'closed: all steps done');
}

// 6) Role gating: SQM can complete fields but not review/send/close.
{
  const steps = getReviewSteps(complete, 'sqm');
  assert(steps[0].allowedForRole, 'sqm: allowed to complete fields');
  assert(!steps[1].allowedForRole, 'sqm: not allowed to review');
  assert(!steps[2].allowedForRole, 'sqm: not allowed to send');
  assert(!steps[3].allowedForRole, 'sqm: not allowed to close');
}

console.log('done');
