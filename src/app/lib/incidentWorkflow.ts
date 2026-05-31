/**
 * incidentWorkflow.ts
 * Shared constants/helpers for incident workflow stages, permissions, and validation.
 *
 * Workflow: New → Investigating → Root Cause Needed → Final Review → Closed
 *
 * Legacy compatibility: existing rows may have "Open". Treat "Open" as
 * equivalent to "New" for display/filter purposes. Persisted values are
 * plain text — no DB enum change required.
 */

export type IncidentStatus =
  | 'New'
  | 'Investigating'
  | 'Root Cause Needed'
  | 'Final Review'
  | 'Closed';

export const INCIDENT_STATUSES: IncidentStatus[] = [
  'New',
  'Investigating',
  'Root Cause Needed',
  'Final Review',
  'Closed',
];

// Statuses that gate workflow progression and require field completeness.
export const FINAL_REVIEW_STATUS: IncidentStatus = 'Final Review';
export const CLOSED_STATUS: IncidentStatus = 'Closed';

// Statuses that should trigger the validation prompt before save.
export const GATED_STATUSES: IncidentStatus[] = [FINAL_REVIEW_STATUS, CLOSED_STATUS];

// Map a legacy/unknown status to a current workflow status for display.
export function normalizeStatus(raw: string | null | undefined): IncidentStatus | '' {
  if (!raw) return '';
  const v = String(raw).trim();
  const lower = v.toLowerCase();
  if (lower === 'open') return 'New';
  // exact match (case-insensitive) to known statuses
  const match = INCIDENT_STATUSES.find(s => s.toLowerCase() === lower);
  return match ?? (v as IncidentStatus);
}

// True if the status (after normalization) requires completeness gating.
export function isGatedStatus(status: string | null | undefined): boolean {
  const n = normalizeStatus(status);
  return GATED_STATUSES.includes(n as IncidentStatus);
}

// Color tokens used by quick-edit pills and badges. Match existing palette.
export const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  New:                 { bg: '#e0e7ff', color: '#4338ca' },
  Investigating:       { bg: '#fef3c7', color: '#92400e' },
  'Root Cause Needed': { bg: '#fed7aa', color: '#9a3412' },
  'Final Review':      { bg: '#dbeafe', color: '#1d4ed8' },
  Closed:              { bg: '#f1f5f9', color: '#475569' },
  // Legacy display: "Open" rows show like "New"
  Open:                { bg: '#e0e7ff', color: '#4338ca' },
};

// Fields required before an incident can be moved to Final Review / Closed.
// `key` is the incident column name; `label` is the human-readable name.
// `closedOnly` fields are only required for Closed (not Final Review).
export interface RequiredField {
  key: string;
  label: string;
  closedOnly?: boolean;
}

export const REQUIRED_FOR_FINAL_REVIEW: RequiredField[] = [
  { key: 'xc_caused',        label: 'Caused by (XConnect / Vendor)' },
  { key: 'vendor_caused',    label: 'Vendor caused' },
  { key: 'failed_component', label: 'Failed component' },
  { key: 'event_category',   label: 'Event category' },
  { key: 'failure_type',     label: 'Failure type' },
  { key: 'product_line',     label: 'Product line' },
  { key: 'root_cause',       label: 'Root cause / conclusion' },
];

// Additional fields required to mark Closed.
export const REQUIRED_FOR_CLOSED_EXTRA: RequiredField[] = [
  { key: 'report_sent',      label: 'Report sent to customer' },
  { key: 'reviewed_at',      label: 'Director review' },
];

// ── Director review ───────────────────────────────────────────────────────────
//
// An incident must carry a director-review stamp (reviewed_by + reviewed_at)
// before it can be Closed. This makes "the director reviewed this" an
// enforced, auditable step rather than an informal expectation.

/** True if the incident has been director-reviewed. */
export function isReviewed(incident: Record<string, any>): boolean {
  return !!(incident && incident.reviewed_at);
}

/**
 * An incident "needs my review" when it is XC-caused or Critical, not yet
 * reviewed, and not already Closed. This is the director's daily queue.
 */
export function needsReview(incident: Record<string, any>): boolean {
  if (!incident) return false;
  if (isReviewed(incident)) return false;
  if (normalizeStatus(incident.incident_status) === CLOSED_STATUS) return false;
  const xc  = String(incident.xc_caused || '').toLowerCase();
  const sev = String(incident.incident_severity || '').toLowerCase();
  return xc === 'yes' || xc === 'inconclusive' || sev === 'critical';
}

// Vendor (the reference link) is only required if vendor_caused is set to "Yes".
function vendorRequired(incident: Record<string, any>): boolean {
  const v = (incident.vendor_caused || '').toString().toLowerCase();
  return v === 'yes';
}

/**
 * Validate an incident record against the required fields for the target status.
 * Returns an array of missing-field labels. Empty array = valid.
 */
export function validateForStatus(
  incident: Record<string, any>,
  targetStatus: string,
): string[] {
  const target = normalizeStatus(targetStatus);
  if (!GATED_STATUSES.includes(target as IncidentStatus)) return [];

  const required = [...REQUIRED_FOR_FINAL_REVIEW];
  if (target === CLOSED_STATUS) required.push(...REQUIRED_FOR_CLOSED_EXTRA);

  const missing: string[] = [];
  for (const f of required) {
    const val = incident[f.key];
    const hasValue = val !== null && val !== undefined && String(val).trim() !== '';
    if (!hasValue) missing.push(f.label);
  }

  if (vendorRequired(incident)) {
    const v = incident.vendor;
    if (!v || String(v).trim() === '') missing.push('Vendor');
  }

  return missing;
}

// ── Review workflow sequence (the intuitive, ordered flow) ───────────────────
//
// The review of an incident is a strict, ordered sequence. Each step unlocks
// only once the previous step is complete:
//
//   1. Complete required fields  (failed component, root cause, etc.)
//   2. Director review           (reviewed_by + reviewed_at)
//   3. Send report to customer   (report_sent timestamp)  ← always the last task
//   4. Close the incident        (incident_status = Closed)
//
// `getReviewSteps` returns this sequence as a checklist the UI can render so
// the user always sees what's done, what's next, and why a step is blocked.

export type ReviewStepId = 'fields' | 'review' | 'sent' | 'closed';

export interface ReviewStep {
  id: ReviewStepId;
  label: string;
  /** This step is finished. */
  done: boolean;
  /** All prerequisite steps are done, so this step may be acted on now. */
  actionable: boolean;
  /** Current user's role is allowed to perform this step's action. */
  allowedForRole: boolean;
  /** Human-readable reason this step is blocked (empty when actionable). */
  blockedReason: string;
  /** Missing field labels — only populated for the 'fields' step. */
  missing: string[];
}

/** True once the report has been sent to the customer. */
export function isReportSent(incident: Record<string, any>): boolean {
  const v = incident?.report_sent;
  return v !== null && v !== undefined && String(v).trim() !== '';
}

/** True once the incident is Closed. */
export function isClosed(incident: Record<string, any>): boolean {
  return normalizeStatus(incident?.incident_status) === CLOSED_STATUS;
}

/**
 * Build the ordered review checklist for an incident. Each step is `done`,
 * `actionable` (prerequisites met), and carries a `blockedReason` for the UI.
 * Role gating: only admins may review / send / close; SQMs may complete fields.
 */
export function getReviewSteps(
  incident: Record<string, any>,
  role: UserRole,
): ReviewStep[] {
  const isAdmin = role === 'admin';

  // Step 1 — required fields (same set that gates Final Review).
  const missing = validateForStatus(incident, FINAL_REVIEW_STATUS);
  const fieldsDone = missing.length === 0;

  // Step 2 — director review.
  const reviewDone = isReviewed(incident);

  // Step 3 — report sent to customer.
  const sentDone = isReportSent(incident);

  // Step 4 — closed.
  const closedDone = isClosed(incident);

  return [
    {
      id: 'fields',
      label: 'Complete required fields',
      done: fieldsDone,
      actionable: !fieldsDone,
      allowedForRole: isAdmin || role === 'sqm',
      blockedReason: '',
      missing,
    },
    {
      id: 'review',
      label: 'Director review',
      done: reviewDone,
      actionable: fieldsDone && !reviewDone,
      allowedForRole: isAdmin,
      blockedReason: !fieldsDone
        ? 'Complete the required fields first.'
        : (!isAdmin ? 'Only the director/admin can mark an incident reviewed.' : ''),
      missing: [],
    },
    {
      id: 'sent',
      label: 'Send report to customer',
      done: sentDone,
      actionable: fieldsDone && reviewDone && !sentDone,
      allowedForRole: isAdmin,
      blockedReason: !reviewDone
        ? 'Director must review the incident first.'
        : (!isAdmin ? 'Only the director/admin can send the report.' : ''),
      missing: [],
    },
    {
      id: 'closed',
      label: 'Close incident',
      done: closedDone,
      actionable: fieldsDone && reviewDone && sentDone && !closedDone,
      allowedForRole: isAdmin,
      blockedReason: !sentDone
        ? 'Send the report to the customer first.'
        : (!isAdmin ? 'Only the director/admin can close an incident.' : ''),
      missing: [],
    },
  ];
}

// ── Action status (corrective/preventive action) ─────────────────────────────
//
// The `incidents.action_status` column has a Postgres CHECK constraint:
//   CHECK (action_status = ANY (ARRAY['Open','In Progress','Complete']))
// Note: 'Complete', NOT 'Completed' — writing the wrong literal raises
// `incidents_action_status_check` and the upsert is rejected.
//
// All persisted values MUST come from this list. UI labels are friendlier
// (`ACTION_STATUS_LABELS`) but the value written to Supabase is the literal.

export type ActionStatus = 'Open' | 'In Progress' | 'Complete';

export const ACTION_STATUSES: ActionStatus[] = ['Open', 'In Progress', 'Complete'];

/** "Complete" is the terminal action status — used by the Closed-incident gate. */
export const ACTION_STATUS_COMPLETE: ActionStatus = 'Complete';

/** Friendly display labels. Keep `Complete` rendered as "Completed" in the UI. */
export const ACTION_STATUS_LABELS: Record<ActionStatus, string> = {
  Open: 'Open',
  'In Progress': 'In Progress',
  Complete: 'Completed',
};

/**
 * Coerce any legacy / free-text `action_status` value to one of the three
 * allowed literals so we never write something the CHECK constraint rejects.
 * Returns null when the input is empty (caller decides whether to persist).
 */
export function normalizeActionStatus(
  raw: string | null | undefined,
): ActionStatus | null {
  if (!raw) return null;
  const v = String(raw).trim();
  if (!v) return null;
  const lower = v.toLowerCase();
  // Direct hits + the common typo `Completed` → canonical `Complete`.
  if (lower === 'complete' || lower === 'completed' || lower === 'done' || lower === 'closed') {
    return ACTION_STATUS_COMPLETE;
  }
  if (lower === 'open') return 'Open';
  if (lower === 'in progress' || lower === 'in-progress' || lower === 'inprogress' || lower === 'pending') {
    return 'In Progress';
  }
  // Unknown values fall through to null so the caller can drop the field
  // rather than persist something the DB will reject.
  return null;
}

/** True if an action_status value (any casing/spelling) represents completion. */
export function isActionStatusComplete(raw: string | null | undefined): boolean {
  return normalizeActionStatus(raw) === ACTION_STATUS_COMPLETE;
}

/**
 * Returns a human-readable list of inconsistencies between the cover status
 * and any sub-section state (e.g. action_status). Used to surface a warning
 * rather than silently producing a contradictory PDF.
 */
export function findStatusInconsistencies(
  incident: Record<string, any>,
): string[] {
  const out: string[] = [];
  const status = normalizeStatus(incident.incident_status);
  if (status === CLOSED_STATUS && incident.action_status && !isActionStatusComplete(incident.action_status)) {
    out.push(
      `Action Status is "${incident.action_status}" but incident is Closed — ` +
        `mark the corrective action as Completed before sending to the customer.`,
    );
  }
  return out;
}

// ── Permissions ──────────────────────────────────────────────────────────────

export type UserRole = 'admin' | 'sqm' | undefined;

// SQMs may transition to any status EXCEPT Closed. Admins can do anything.
export function canSetStatus(role: UserRole, targetStatus: string): boolean {
  const target = normalizeStatus(targetStatus);
  if (role === 'admin') return true;
  if (role === 'sqm')   return target !== CLOSED_STATUS;
  return false;
}

// Only admins can toggle "report sent" (final report send/closure action).
export function canMarkReportSent(role: UserRole): boolean {
  return role === 'admin';
}

// Both admins and SQMs may edit incident details. (Read-only viewers, if any
// future role is added, would return false here.)
export function canEditIncident(role: UserRole): boolean {
  return role === 'admin' || role === 'sqm';
}

// Status options surfaced to the user for a given role (used by quick-edit pills).
export function statusOptionsForRole(role: UserRole): IncidentStatus[] {
  if (role === 'admin') return INCIDENT_STATUSES;
  // SQMs cannot move things to Closed via the quick-edit
  return INCIDENT_STATUSES.filter(s => s !== CLOSED_STATUS);
}
