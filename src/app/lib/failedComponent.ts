/**
 * Resolve the human-readable label for an incident's `failed_component`
 * (or `failure_type`) value.
 *
 * Background: incidents.failed_component historically pointed at
 * `lists.row_id` (per scripts/configs/incidents.json), but the new
 * IncidentForm dropdown is populated from the `components` table. As a
 * result, depending on when the incident was created, the stored value
 * can be either a `lists.row_id` OR a `components.row_id`.
 *
 * To make sure the rendered label is always human-readable — and never a
 * raw row_id like `zMZ20AuctS4jiOrtVD-7Qd` in a customer-facing PDF — we
 * check both lookup tables and fall back to a friendly placeholder when
 * neither match.
 */

export type ListLikeMap = Record<
  string,
  { failed_component?: string | null; failure_type?: string | null }
>;

export type ComponentMap = Record<string, { failed_component?: string | null }>;

/**
 * Heuristic: the AppSheet/Supabase row_ids in this codebase look like
 * `zMZ20AuctS4jiOrtVD-7Qd` (random 20+ char tokens) or UUIDs. If the saved
 * value already looks like a human label (spaces, lowercase words, etc.),
 * just show it verbatim.
 */
export function looksLikeRowId(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (/\s/.test(v)) return false; // human labels usually have a space
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) return true;
  // AppSheet-style: 16+ chars, no spaces, mixed case/digits/underscore/dash
  return /^[A-Za-z0-9_-]{16,}$/.test(v);
}

/**
 * Resolve a `failed_component` value to its display label.
 * Returns `fallback` (default "—") when the value can't be resolved
 * to a human-readable label — never leaks a raw row_id to the user.
 */
export function resolveFailedComponentLabel(
  value: string | null | undefined,
  listMap: ListLikeMap,
  componentsMap?: ComponentMap,
  fallback = '—',
): string {
  if (!value) return fallback;
  const v = String(value).trim();
  if (!v) return fallback;

  const fromList = listMap[v]?.failed_component;
  if (fromList) return fromList;

  const fromComponents = componentsMap?.[v]?.failed_component;
  if (fromComponents) return fromComponents;

  // No match — only show the raw value if it's clearly a human label.
  if (!looksLikeRowId(v)) return v;
  return fallback;
}

/**
 * Resolve a `failure_type` value to its display label.
 * Same shape as resolveFailedComponentLabel but only the `lists` table
 * holds failure_type labels (components doesn't carry them).
 */
export function resolveFailureTypeLabel(
  value: string | null | undefined,
  listMap: ListLikeMap,
  fallback = '—',
): string {
  if (!value) return fallback;
  const v = String(value).trim();
  if (!v) return fallback;

  const fromList = listMap[v]?.failure_type;
  if (fromList) return fromList;

  if (!looksLikeRowId(v)) return v;
  return fallback;
}
