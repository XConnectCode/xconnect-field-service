/**
 * PanelsSeenPicker.tsx
 * Shared multi-select for "panels seen on a field visit". Renders removable
 * chips + a type-ahead search box + a collapsible "browse all by type" list,
 * all writing to a `string[]` of panel serials. Used by both the create/edit
 * dialog (FieldVisitForm) and the detail edit view (FieldVisitDetail) so the
 * two never diverge.
 */

import { useState } from 'react';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { getSerial } from '../lib/serialUtils';

interface Props {
  /** All panels (serial_number, panel_type) loaded from the panels table. */
  panels: any[];
  /** Currently selected serials. */
  value: string[];
  /** Replace the selected serials. */
  onChange: (next: string[]) => void;
}

export default function PanelsSeenPicker({ panels, value, onChange }: Props) {
  const [panelSearch, setPanelSearch] = useState('');
  const [showAllPanels, setShowAllPanels] = useState(false);

  const togglePanelSeen = (serial: string) =>
    onChange(value.includes(serial) ? value.filter(s => s !== serial) : [...value, serial]);
  const addPanelSeen = (serial: string) => {
    if (!value.includes(serial)) onChange([...value, serial]);
  };
  const removePanelSeen = (serial: string) =>
    onChange(value.filter(s => s !== serial));

  const panelsByType = (type: string) => panels.filter(p => p.panel_type === type);

  // Common legacy types lead; any remaining types follow alphabetically.
  const TYPE_ORDER = ['Digital Shooting Panel', 'Surface Tester', 'P2500', 'P2000', 'P1000'];
  const allTypes = Array.from(new Set(panels.map(p => p.panel_type).filter(Boolean)));
  const orderedTypes = [
    ...TYPE_ORDER.filter(t => allTypes.includes(t)),
    ...allTypes.filter(t => !TYPE_ORDER.includes(t)).sort(),
  ];
  const panelTypeGroups = orderedTypes
    .map(type => ({ type, panels: panelsByType(type) }))
    .filter(g => g.panels.length > 0);

  // Selected serials that aren't in the current panel list (e.g. legacy data).
  const knownSerials = new Set(panels.map(p => getSerial(p)));
  const orphanSeen = value.filter(s => !knownSerials.has(s));

  // Serial -> panel_type lookup for chip / search-result labels.
  const typeBySerial = new Map<string, string>(
    panels.map(p => [getSerial(p), p.panel_type || ''])
  );

  const searchQ = panelSearch.trim().toLowerCase();
  const searchResults = searchQ === ''
    ? []
    : panels
        .filter(p => {
          const serial = getSerial(p);
          if (value.includes(serial)) return false;
          const hay = `${serial} ${p.panel_type || ''}`.toLowerCase();
          return hay.includes(searchQ);
        })
        .slice(0, 30);

  return (
    <div>
      <Label className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1 block">
        Flag every panel you saw on this visit
        <span className="ml-2 font-normal text-gray-400">
          ({value.length} selected · marks each Verified = Y)
        </span>
      </Label>

      {/* ── Selected panels: removable chips ──────────────────────────── */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {value.map(serial => {
            const t = typeBySerial.get(serial);
            return (
              <span
                key={serial}
                className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full text-xs bg-blue-600 text-white"
              >
                {serial}{t ? <span className="opacity-70">· {t}</span> : null}
                <button
                  type="button"
                  onClick={() => removePanelSeen(serial)}
                  className="ml-0.5 w-4 h-4 inline-flex items-center justify-center rounded-full hover:bg-blue-700"
                  title={`Remove ${serial}`}
                  aria-label={`Remove ${serial}`}
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
      )}

      {/* ── Type-ahead search ─────────────────────────────────────────── */}
      <div className="relative">
        <Input
          value={panelSearch}
          onChange={e => setPanelSearch(e.target.value)}
          placeholder="Search panels by serial # or type to add…"
          autoComplete="off"
        />
        {searchQ !== '' && (
          <div className="absolute z-20 left-0 right-0 mt-1 max-h-60 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 shadow-lg">
            {searchResults.length === 0 ? (
              <div className="px-3 py-2 text-sm text-gray-400">No matching panels.</div>
            ) : (
              searchResults.map(p => {
                const serial = getSerial(p);
                return (
                  <button
                    type="button"
                    key={serial}
                    onClick={() => { addPanelSeen(serial); setPanelSearch(''); }}
                    className="w-full text-left px-3 py-2 text-sm flex items-center justify-between hover:bg-blue-50 dark:hover:bg-gray-800"
                  >
                    <span className="font-medium text-gray-800 dark:text-gray-100">{serial}</span>
                    <span className="text-xs text-gray-400">{p.panel_type || ''}</span>
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* ── Collapsible: browse all panels grouped by type ───────────── */}
      <button
        type="button"
        onClick={() => setShowAllPanels(v => !v)}
        className="mt-2 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
      >
        {showAllPanels ? '▾ Hide full list' : '▸ Browse all panels by type'}
      </button>

      {showAllPanels && (
        <div className="mt-2 space-y-3 border border-gray-200 dark:border-gray-700 rounded-md p-3 max-h-72 overflow-y-auto">
          {panelTypeGroups.length === 0 && (
            <p className="text-sm text-gray-400">No panels available.</p>
          )}
          {panelTypeGroups.map(({ type, panels }) => (
            <div key={type}>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">{type}</div>
              <div className="flex flex-wrap gap-1.5">
                {panels.map(p => {
                  const serial = getSerial(p);
                  const on = value.includes(serial);
                  return (
                    <button
                      type="button"
                      key={serial}
                      onClick={() => togglePanelSeen(serial)}
                      className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                        on
                          ? 'bg-blue-600 border-blue-600 text-white'
                          : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:border-blue-400'
                      }`}
                    >
                      {on ? '✓ ' : ''}{serial}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Serials selected here but no longer in the panel list (e.g. legacy
          values) are preserved so editing never silently drops them. */}
      {orphanSeen.length > 0 && (
        <p className="mt-2 text-[11px] text-gray-400">
          {orphanSeen.length} selected panel{orphanSeen.length > 1 ? 's are' : ' is'} not in the current panel list (legacy) — still saved.
        </p>
      )}
    </div>
  );
}
