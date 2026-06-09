/**
 * Field-visit duration helpers.
 *
 * `visit_duration` is a derived value: it is the elapsed time between a visit's
 * arrival and departure timestamps. Historically some rows stored it as an
 * `HH:MM:SS` text literal (synced from AppSheet) while imported / newer rows
 * leave it null. Rather than treating it as a manually-editable field, the UI
 * computes it from arrival → departure so it is always correct and never out of
 * sync. These helpers centralise that logic.
 */

/** Format a millisecond span as HH:MM:SS (hours can exceed 24). */
function fmtSpan(ms: number): string {
  let secs = Math.floor(ms / 1000);
  const h = Math.floor(secs / 3600); secs -= h * 3600;
  const m = Math.floor(secs / 60);   secs -= m * 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(secs)}`;
}

/**
 * Compute the duration HH:MM:SS from arrival/departure timestamps.
 * Returns null when either endpoint is missing/invalid or departure precedes
 * arrival.
 */
export function computeVisitDuration(
  arrival?: string | null,
  departure?: string | null,
): string | null {
  if (!arrival || !departure) return null;
  const a = new Date(arrival).getTime();
  const d = new Date(departure).getTime();
  if (Number.isNaN(a) || Number.isNaN(d) || d < a) return null;
  return fmtSpan(d - a);
}

/**
 * Display duration for a visit: prefer the live arrival→departure computation,
 * then fall back to any stored `visit_duration` literal, then a dash.
 */
export function displayVisitDuration(visit: {
  arrival_date?: string | null;
  departure_date?: string | null;
  visit_duration?: string | null;
} | null | undefined): string {
  if (!visit) return '-';
  const computed = computeVisitDuration(visit.arrival_date, visit.departure_date);
  if (computed) return computed;
  if (visit.visit_duration) return visit.visit_duration;
  return '-';
}

/**
 * Timestamps are stored in Postgres as `timestamptz` (UTC). A native
 * `<input type="datetime-local">` works in the user's LOCAL time zone, so we
 * must convert in both directions or the displayed time drifts by the UTC
 * offset (e.g. 6 hours in America/Denver).
 *
 * `toLocalInputValue` turns a stored ISO/UTC timestamp into the
 * `YYYY-MM-DDTHH:mm` string a datetime-local input expects, expressed in the
 * browser's local time zone. This makes the edit field match what the
 * read-only view (which uses `toLocaleString`) shows.
 */
export function toLocalInputValue(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  // Shift by the local offset so toISOString()'s UTC slice reflects local wall-clock time.
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

/**
 * Inverse of `toLocalInputValue`: take the local-wall-clock string produced by
 * a datetime-local input and return a full ISO (UTC) string suitable for
 * storage in a `timestamptz` column. Returns null for empty/invalid input.
 */
export function fromLocalInputValue(localStr?: string | null): string | null {
  if (!localStr) return null;
  // `new Date('YYYY-MM-DDTHH:mm')` is parsed as LOCAL time by browsers, which
  // is exactly what the user typed; toISOString() then normalises to UTC.
  const d = new Date(localStr);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}
