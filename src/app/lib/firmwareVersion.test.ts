// Tests for per-panel-type firmware display helpers.
// Run: npx --yes tsx src/app/lib/firmwareVersion.test.ts
import assert from 'node:assert';
import {
  applicableFirmwareFields,
  panelFirmwareParts,
  formatPanelFirmware,
} from './firmwareVersion';

// ── applicableFirmwareFields ────────────────────────────────────────────────

// Surface Tester: WL + Surface + Logging (no GUI, no Shooting).
assert.deepStrictEqual(
  applicableFirmwareFields('Surface Tester', 'Leased'),
  ['wl_controlfw', 'surfacefw', 'loggingfw'],
);

// Digital Shooting Panel: WL + Shooting + Logging.
assert.deepStrictEqual(
  applicableFirmwareFields('Digital Shooting Panel', 'At Facility'),
  ['wl_controlfw', 'shootingfw', 'loggingfw'],
);

// P2500 Leased: WL + Logging + GUI.
assert.deepStrictEqual(
  applicableFirmwareFields('P2500', 'Leased'),
  ['wl_controlfw', 'loggingfw', 'gui_version'],
);

// P2500 At Facility: GUI does NOT apply (status gate).
assert.deepStrictEqual(
  applicableFirmwareFields('P2500', 'At Facility'),
  ['wl_controlfw', 'loggingfw'],
);

// Unknown / other type: WL + Logging only.
assert.deepStrictEqual(
  applicableFirmwareFields('Pressure Box', 'Leased'),
  ['wl_controlfw', 'loggingfw'],
);

// ── panelFirmwareParts: skips empty/N-A, keeps real values ──────────────────

const p2500 = {
  panel_type: 'P2500',
  panel_status: 'Leased',
  wl_controlfw: '245',
  loggingfw: '7.2',
  gui_version: '25.08.1',
  surfacefw: '1.0',     // not applicable to P2500 -> excluded
  shootingfw: 'Na',     // not applicable + junk
};
assert.deepStrictEqual(
  panelFirmwareParts(p2500).map((x) => x.field),
  ['wl_controlfw', 'loggingfw', 'gui_version'],
);

// A Surface Tester missing WL but having Surface FW: only Surface shows.
const surface = {
  panel_type: 'Surface Tester',
  panel_status: 'Leased',
  wl_controlfw: '',     // empty -> skipped
  surfacefw: '3.4',
  loggingfw: 'n/a',     // empty token -> skipped
};
assert.deepStrictEqual(
  panelFirmwareParts(surface).map((x) => `${x.label}:${x.value}`),
  ['Surface:3.4'],
);

// ── formatPanelFirmware: stacked one-liner ──────────────────────────────────

assert.strictEqual(
  formatPanelFirmware(p2500),
  'WL: 245 · Logging: 7.2 · GUI: 25.08.1',
);

// No applicable firmware values -> empty string (table shows '-').
assert.strictEqual(
  formatPanelFirmware({ panel_type: 'Pressure Box', panel_status: 'Leased' }),
  '',
);

console.log('firmwareVersion tests passed');
