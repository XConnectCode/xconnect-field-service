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
