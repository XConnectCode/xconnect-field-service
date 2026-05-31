import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { ChevronDown, ChevronRight, Cpu, Pencil, Save, X, AlertTriangle } from 'lucide-react';
import {
  FIRMWARE_FIELDS,
  FIRMWARE_LABELS,
  evaluateFirmware,
  type FirmwareField,
  type FirmwareTargets,
} from '../lib/firmwareVersion';

interface Props {
  panels: any[];
  targets: FirmwareTargets;
  /** which firmware field is currently being filtered on ('' = none) */
  activeFilter: FirmwareField | '';
  onFilterChange: (field: FirmwareField | '') => void;
  /** admin can edit targets; saving calls onSaveTargets */
  canEdit: boolean;
  onSaveTargets: (next: Record<FirmwareField, string>) => Promise<void>;
}

// Per-firmware tallies across the (already-filtered-by-other-filters) panel set.
function useFirmwareCounts(panels: any[], targets: FirmwareTargets) {
  return useMemo(() => {
    const counts: Record<FirmwareField, { behind: number; review: number; total: number }> = {
      gui_version:  { behind: 0, review: 0, total: 0 },
      wl_controlfw: { behind: 0, review: 0, total: 0 },
      surfacefw:    { behind: 0, review: 0, total: 0 },
      shootingfw:   { behind: 0, review: 0, total: 0 },
      loggingfw:    { behind: 0, review: 0, total: 0 },
    };
    for (const f of FIRMWARE_FIELDS) {
      for (const p of panels) {
        const status = evaluateFirmware(p?.[f], targets?.[f]);
        // "applicable" = panel has a value for this firmware OR a target exists
        if (status === 'no_target') continue;
        if (status === 'missing') continue;
        counts[f].total += 1;
        if (status === 'behind') counts[f].behind += 1;
        if (status === 'needs_review') counts[f].review += 1;
      }
    }
    return counts;
  }, [panels, targets]);
}

export default function FirmwareStatusPanel({
  panels, targets, activeFilter, onFilterChange, canEdit, onSaveTargets,
}: Props) {
  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<FirmwareField, string>>(() => ({
    gui_version:  targets?.gui_version  ?? '',
    wl_controlfw: targets?.wl_controlfw ?? '',
    surfacefw:    targets?.surfacefw    ?? '',
    shootingfw:   targets?.shootingfw   ?? '',
    loggingfw:    targets?.loggingfw    ?? '',
  }));
  const [saving, setSaving] = useState(false);

  const counts = useFirmwareCounts(panels, targets);

  const startEdit = () => {
    setDraft({
      gui_version:  targets?.gui_version  ?? '',
      wl_controlfw: targets?.wl_controlfw ?? '',
      surfacefw:    targets?.surfacefw    ?? '',
      shootingfw:   targets?.shootingfw   ?? '',
      loggingfw:    targets?.loggingfw    ?? '',
    });
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      await onSaveTargets(draft);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const totalBehind = FIRMWARE_FIELDS.reduce((s, f) => s + counts[f].behind, 0);
  const totalReview = FIRMWARE_FIELDS.reduce((s, f) => s + counts[f].review, 0);
  const lastUpdated = targets?.updated_at
    ? new Date(targets.updated_at).toLocaleDateString()
    : null;

  return (
    <Card className="mb-6 border-slate-200">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <button
            type="button"
            onClick={() => setExpanded(e => !e)}
            className="flex items-center gap-2 text-gray-900 hover:text-gray-600"
          >
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            <Cpu className="w-4 h-4" />
            Firmware Status
            {totalBehind > 0 && (
              <Badge className="bg-amber-500 hover:bg-amber-600 text-white ml-1">
                {totalBehind} behind
              </Badge>
            )}
            {totalReview > 0 && (
              <Badge variant="outline" className="border-orange-400 text-orange-600 ml-1">
                {totalReview} need review
              </Badge>
            )}
            {totalBehind === 0 && totalReview === 0 && (
              <Badge className="bg-green-600 hover:bg-green-700 text-white ml-1">All up to date</Badge>
            )}
          </button>
          {canEdit && expanded && !editing && (
            <Button variant="ghost" size="sm" onClick={startEdit} className="text-gray-500">
              <Pencil className="w-3.5 h-3.5 mr-1" /> Set targets
            </Button>
          )}
        </CardTitle>
      </CardHeader>

      {expanded && (
        <CardContent className="pt-0">
          <p className="text-xs text-gray-500 mb-3">
            Target = the current/latest version each panel should be running. Panels below target are flagged for update.
            {lastUpdated && <> Targets last set {lastUpdated}{targets?.updated_by ? ` by ${targets.updated_by}` : ''}.</>}
          </p>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {FIRMWARE_FIELDS.map(f => {
              const c = counts[f];
              const target = targets?.[f];
              const active = activeFilter === f;
              const hasIssues = c.behind > 0 || c.review > 0;
              return (
                <div
                  key={f}
                  className={`rounded-lg border p-3 ${active ? 'ring-2 ring-blue-400 border-blue-300' : 'border-gray-200'}`}
                >
                  <div className="text-xs font-medium text-gray-600">{FIRMWARE_LABELS[f]}</div>

                  {editing ? (
                    <Input
                      value={draft[f]}
                      onChange={e => setDraft(d => ({ ...d, [f]: e.target.value }))}
                      placeholder="target version"
                      className="mt-1 h-8 text-sm"
                    />
                  ) : (
                    <>
                      <div className="text-lg font-bold text-gray-900 mt-0.5">
                        {target && String(target).trim() ? target : <span className="text-gray-400 text-sm font-normal">— not set —</span>}
                      </div>
                      <div className="mt-1 min-h-[20px]">
                        {!target ? (
                          <span className="text-xs text-gray-400">set a target to track</span>
                        ) : hasIssues ? (
                          <button
                            type="button"
                            onClick={() => onFilterChange(active ? '' : f)}
                            className="text-xs text-amber-700 dark:text-amber-400 hover:underline flex items-center gap-1"
                            title={active ? 'Clear filter' : 'Show only panels behind on this firmware'}
                          >
                            {c.behind > 0 && <span>{c.behind} behind</span>}
                            {c.behind > 0 && c.review > 0 && <span>·</span>}
                            {c.review > 0 && (
                              <span className="flex items-center gap-0.5 text-orange-600">
                                <AlertTriangle className="w-3 h-3" />{c.review} review
                              </span>
                            )}
                          </button>
                        ) : (
                          <span className="text-xs text-green-600">all {c.total} up to date</span>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {editing && (
            <div className="flex items-center gap-2 mt-3">
              <Button size="sm" onClick={save} disabled={saving}>
                <Save className="w-3.5 h-3.5 mr-1" /> {saving ? 'Saving…' : 'Save targets'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
                <X className="w-3.5 h-3.5 mr-1" /> Cancel
              </Button>
            </div>
          )}

          {activeFilter && !editing && (
            <div className="mt-3 text-xs text-blue-700 flex items-center gap-2">
              <span>Showing only panels behind on <strong>{FIRMWARE_LABELS[activeFilter]}</strong></span>
              <button onClick={() => onFilterChange('')} className="underline hover:text-blue-900">clear</button>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
