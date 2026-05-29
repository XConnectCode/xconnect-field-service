/**
 * Resolve the human-readable label for an incident's `failed_component`
 * (component name) or `failure_type` (failure category) values.
 *
 * Authoritative table mapping (verified directly against the Supabase
 * database, project "FST APP" / gbllxumuogsncoiaksum):
 *
 *   incidents.failed_component → components.row_id
 *     SELECT failed_component FROM components WHERE row_id = ...
 *     (e.g. 'zMZ20AuctS4jiOrtVD-7Qd' = "XC2.75 Standard Bottom End Plate".
 *      All 371 incidents resolve cleanly via this table; 0 orphaned.)
 *
 *   incidents.failure_type → lists.row_id
 *     SELECT failure_type FROM lists WHERE row_id = ...
 *
 * Do NOT cross-resolve through the other table — lists.failed_component is
 * sparse/unreliable and was the source of the blank/raw-id bug on
 * Incident #572. components has no failure_type column at all.
 *
 * Fallback: if a stored value isn't in the expected table we never return
 * the raw row_id to the user — we return the configured fallback ("—" by
 * default, or "N/A" / "" depending on where the caller wants the gap to
 * show up).
 */

export type ListLikeMap = Record<
  string,
  { failed_component?: string | null; failure_type?: string | null }
>;

export type ComponentMap = Record<string, { failed_component?: string | null }>;

/**
 * Heuristic: the AppSheet/Supabase row_ids in this codebase look like
 * `zMZ20AuctS4jiOrtVD-7Qd` (random 20+ char tokens) or UUIDs. If the saved
 * value already looks like a human label, show it verbatim instead of
 * dropping to the fallback — this preserves any legacy free-text rows.
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
 * Resolve `incidents.failed_component` to its display label via the
 * `components` table (THE authoritative source). Returns `fallback` when
 * the value can't be resolved — never leaks a raw row_id to the user.
 *
 * The legacy second-positional `listMap` argument is accepted for backward
 * compatibility with existing callers; it is intentionally ignored. The
 * `componentsMap` is the only map consulted.
 */
export function resolveFailedComponentLabel(
  value: string | null | undefined,
  componentsMap: ComponentMap | null | undefined,
  fallback = '—',
): string {
  if (!value) return fallback;
  const v = String(value).trim();
  if (!v) return fallback;

  const fromComponents = componentsMap?.[v]?.failed_component;
  if (fromComponents) return fromComponents;

  // No match — only show the raw value if it's clearly a human label.
  if (!looksLikeRowId(v)) return v;
  return fallback;
}

/**
 * Resolve `incidents.failure_type` to its display label via the `lists`
 * table. components has no failure_type column.
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
