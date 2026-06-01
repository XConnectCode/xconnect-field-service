/**
 * xcLocations.ts
 * Single source of truth for XConnect base/district location options.
 *
 * Historically this concept was duplicated and spelled inconsistently:
 *   - Panels (XC Base): hard-coded ['Denver','Midland','Williston']
 *   - Incidents (XC District): free-text input
 * Centralising here keeps them aligned and prevents future drift.
 *
 * Note the deliberate split:
 *   - XC_BASES        → the two operational bases loads run out of (Midland, Williston).
 *                       Used by Incidents (XC District) and the Driver/QC origin field.
 *   - XC_PANEL_BASES  → Panels additionally tracks Denver, where inventory lives.
 */

export const XC_BASES = ['Midland', 'Williston'] as const;
export const XC_PANEL_BASES = ['Denver', 'Midland', 'Williston'] as const;

export type XcBase = (typeof XC_BASES)[number];
export type XcPanelBase = (typeof XC_PANEL_BASES)[number];
