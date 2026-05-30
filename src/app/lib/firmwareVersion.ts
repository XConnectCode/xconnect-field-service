// firmwareVersion.ts
// Utilities for comparing panel firmware values against fleet "target" versions.
//
// Firmware values in the wild are messy: dotted versions ("25.12", "25.08.1"),
// plain integers ("247", "187"), and junk ("Na", "n/a", "1..2", "").
// We parse what we can numerically and flag the rest as "needs review".

export type FirmwareField =
  | 'gui_version'
  | 'wl_controlfw'
  | 'surfacefw'
  | 'shootingfw'
  | 'loggingfw';

export interface FirmwareTargets {
  gui_version?: string | null;
  wl_controlfw?: string | null;
  surfacefw?: string | null;
  shootingfw?: string | null;
  loggingfw?: string | null;
  updated_at?: string | null;
  updated_by?: string | null;
}

// Human-readable labels for each firmware field.
export const FIRMWARE_LABELS: Record<FirmwareField, string> = {
  gui_version:  'GUI',
  wl_controlfw: 'WL Control FW',
  surfacefw:    'Surface Test FW',
  shootingfw:   'Shooting FW',
  loggingfw:    'Logging FW',
};

export const FIRMWARE_FIELDS: FirmwareField[] = [
  'gui_version',
  'wl_controlfw',
  'surfacefw',
  'shootingfw',
  'loggingfw',
];

// Strings that explicitly mean "no firmware / not applicable" — treated as
// empty rather than "needs review" so they don't pollute the out-of-date list.
const EMPTY_TOKENS = new Set(['', 'na', 'n/a', 'none', '-', '—', 'null']);

export function isEmptyValue(raw: unknown): boolean {
  if (raw === null || raw === undefined) return true;
  return EMPTY_TOKENS.has(String(raw).trim().toLowerCase());
}

// Parse a version string into an array of numeric segments.
// "25.08.1" -> [25, 8, 1]; "247" -> [247]; "5.9" -> [5, 9].
// Returns null if the value can't be parsed into clean numeric segments
// (e.g. "1..2" yields an empty segment, "abc" is non-numeric).
export function parseVersion(raw: unknown): number[] | null {
  if (isEmptyValue(raw)) return null;
  const s = String(raw).trim();
  // Allow only digits and dots; anything else (letters, double dots producing
  // empty segments) is treated as unparseable.
  if (!/^\d+(\.\d+)*$/.test(s)) return null;
  const parts = s.split('.').map((p) => Number(p));
  if (parts.some((n) => Number.isNaN(n))) return null;
  return parts;
}

// Numeric, segment-wise comparison. Returns:
//  -1 if a < b, 0 if equal, 1 if a > b. Missing trailing segments treated as 0,
// so "25.12" === "25.12.0".
export function compareVersions(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av < bv) return -1;
    if (av > bv) return 1;
  }
  return 0;
}

export type FirmwareStatus =
  | 'up_to_date'    // parsed and >= target
  | 'behind'        // parsed and < target
  | 'ahead'         // parsed and > target (newer than target — informational)
  | 'needs_review'  // value present but unparseable (e.g. "1..2")
  | 'missing'       // no value / N/A on the panel
  | 'no_target';    // no target set for this field

// Compare a single panel's firmware value to the configured target.
export function evaluateFirmware(panelValue: unknown, target: unknown): FirmwareStatus {
  const targetEmpty = isEmptyValue(target);
  if (targetEmpty) return 'no_target';

  if (isEmptyValue(panelValue)) return 'missing';

  const pv = parseVersion(panelValue);
  const tv = parseVersion(target);

  // If either side is unparseable, fall back to exact string match; if it
  // doesn't match exactly, the panel value needs a human to review it.
  if (pv === null || tv === null) {
    return String(panelValue).trim() === String(target).trim()
      ? 'up_to_date'
      : 'needs_review';
  }

  const cmp = compareVersions(pv, tv);
  if (cmp < 0) return 'behind';
  if (cmp > 0) return 'ahead';
  return 'up_to_date';
}

// "behind" or "needs_review" both warrant attention when planning an update.
export function needsAttention(status: FirmwareStatus): boolean {
  return status === 'behind' || status === 'needs_review';
}

// Map a panel + targets to a per-field status object. Only includes fields
// that have a value on the panel OR a target set — avoids flagging firmware
// that doesn't apply to that panel type (e.g. surfacefw on a P2500).
export function evaluatePanelFirmware(
  panel: Record<string, unknown>,
  targets: FirmwareTargets,
): Record<FirmwareField, FirmwareStatus> {
  const out = {} as Record<FirmwareField, FirmwareStatus>;
  for (const f of FIRMWARE_FIELDS) {
    out[f] = evaluateFirmware(panel?.[f], targets?.[f]);
  }
  return out;
}
