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
];

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
