// AppSheet stores link columns as a JSON object string like
//   {"Url":"https://…","LinkText":"https://…"}
// Older rows may hold a bare URL string, and many rows hold an empty
//   {"Url":"","LinkText":""}. Extract the real https URL or return '' so the
// UI can decide whether to show a link at all. (Previously the raw JSON blob
// was used as an href, so the browser treated it as a relative path and
// prefixed it with the app domain — the bug where the link picked up the
// app's own URL as a prefix.)
export function parseSlackUrl(raw?: string | null): string {
  if (!raw) return '';
  const val = String(raw).trim();
  if (!val) return '';
  // JSON-wrapped (AppSheet) form.
  if (val.startsWith('{')) {
    try {
      const obj = JSON.parse(val);
      const url = (obj?.Url ?? obj?.url ?? obj?.LinkText ?? '').toString().trim();
      return /^https?:\/\//i.test(url) ? url : '';
    } catch { return ''; }
  }
  // Bare URL form.
  return /^https?:\/\//i.test(val) ? val : '';
}
