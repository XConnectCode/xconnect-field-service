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
 * Visit timestamps were imported from AppSheet as NAIVE wall-clock values:
 * the string `2026-06-05 12:22:00+00` means "12:22 PM" literally, regardless
 * of time zone. The Edit Visit modal treats them this way (it slices the raw
 * string into the datetime-local input and saves it back unchanged), so the
 * whole app must do the same to stay consistent. We therefore NEVER apply a
 * UTC↔local conversion (no `toLocaleString`, no offset shifting) — doing so
 * shifts the displayed time by the local offset (e.g. 6h in America/Denver)
 * and makes the detail page disagree with the modal.
 */

/** Pull the `YYYY-MM-DDTHH:mm` slice a datetime-local input expects, verbatim. */
export function toInputValue(stored?: string | null): string {
  if (!stored) return '';
  // Stored form is `YYYY-MM-DD HH:MM:SS+00` or ISO `YYYY-MM-DDTHH:MM...`.
  // Normalise the date/time separator to 'T' and take the first 16 chars.
  return stored.replace(' ', 'T').slice(0, 16);
}

/**
 * Format a stored timestamp for read-only display as `M/D/YYYY, h:mm:ss AM/PM`
 * using its RAW wall-clock components — no time-zone conversion. This matches
 * the wall-clock the Edit modal shows/saves.
 */
export function formatVisitTimestamp(stored?: string | null): string {
  if (!stored) return '—';
  // Match `YYYY-MM-DD[ T]HH:MM[:SS]`.
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(stored);
  if (!m) return stored;
  const [, y, mo, d, hh, mm, ss] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  let hour = Number(hh);
  const minute = mm;
  const second = ss ?? '00';
  const ampm = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12;
  if (hour === 0) hour = 12;
  return `${month}/${day}/${year}, ${hour}:${minute}:${second} ${ampm}`;
}
