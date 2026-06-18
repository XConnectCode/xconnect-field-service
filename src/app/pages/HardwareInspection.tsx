import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '../lib/auth-context';
import { fieldVisitApi, hardwareInspectionApi } from '../lib/api';
import { projectId, publicAnonKey } from '../../../utils/supabase/info';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import ImageUpload from '../components/ImageUpload';
import {
  ArrowLeft,
  Save,
  Loader2,
  Plus,
  Trash2,
  Wrench,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';

const baseUrl = `https://${projectId}.supabase.co/functions/v1/make-server-64775d98`;

// ── Component categories (derived from the components catalog) ──────────────────
// The SQM picks a category, then optionally a specific part from the live
// catalog (filtered by keywords below).
const COMPONENT_CATEGORIES = [
  'Top Sub / Connection',
  'Bottom Connection / End Plate',
  'Tandem Sub (Reusable)',
  'Firing Head',
  'Retainer Nut',
  'Quick Change (Bell / Body / Neck / Insert)',
  'Direct Connect Sub',
  'Crossover / Adapter',
  'Pumpdown Sub / Ring',
  'Other',
];

// Keyword filters used to narrow the catalog dropdown per category.
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  'Top Sub / Connection': ['top sub', 'attenuator sub', 'ccl', 'top end'],
  'Bottom Connection / End Plate': ['bottom end plate', 'bottom plug', 'bottom sub', 'lower cap'],
  'Tandem Sub (Reusable)': ['tandem sub'],
  'Firing Head': ['firing head'],
  'Retainer Nut': ['retainer nut', 'castle nut', 'retaining nut'],
  'Quick Change (Bell / Body / Neck / Insert)': ['quick change'],
  'Direct Connect Sub': ['direct connect'],
  'Crossover / Adapter': ['crossover', 'adapter', 'acme'],
  'Pumpdown Sub / Ring': ['pumpdown', 'pump down'],
  'Other': [],
};

// ── Per-component wear checks. Checking a box means "issue found". ──────────────
const CHECK_DEFS: { key: ChkKey; label: string; hint: string }[] = [
  { key: 'chk_threads', label: 'Thread wear', hint: 'Galling, stretching, peening, damaged crests, debris' },
  { key: 'chk_pitting', label: 'Pitting', hint: 'Surface pitting on body, threads or seal faces' },
  { key: 'chk_corrosion', label: 'Corrosion', hint: 'Rust / erosion' },
  { key: 'chk_sealing_surfaces', label: 'Sealing surface damage', hint: 'Nicks, scoring, gouges, O-ring groove damage' },
  { key: 'chk_makeup_feel', label: 'Hard make-up', hint: "Doesn't thread / torque with ease; binding" },
  { key: 'chk_bore_retainer', label: 'Bore / retainer nut issue', hint: 'Firing head: bore obstruction or retainer nut not flush (Op. Alert)' },
  { key: 'chk_general_damage', label: 'Cracks / deformation', hint: 'Impact damage, cracks, excessive general wear' },
];

type ChkKey =
  | 'chk_threads' | 'chk_pitting' | 'chk_corrosion' | 'chk_sealing_surfaces'
  | 'chk_makeup_feel' | 'chk_bore_retainer' | 'chk_general_damage';

const ITEM_STATUSES = ['pass', 'monitor', 'replace_soon', 'remove'] as const;
type ItemStatus = typeof ITEM_STATUSES[number];

const STATUS_LABEL: Record<string, string> = {
  pass: 'Pass',
  monitor: 'Monitor',
  replace_soon: 'Replace soon',
  remove: 'Remove from service',
};

const STATUS_BADGE: Record<string, string> = {
  pass: 'bg-green-100 text-green-800 border-green-200',
  monitor: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  replace_soon: 'bg-orange-100 text-orange-800 border-orange-200',
  remove: 'bg-red-100 text-red-800 border-red-200',
};

interface InspItem {
  client_key: string;       // stable key for React + photo tagging
  component_category: string;
  component_name: string;
  chk_threads: boolean;
  chk_pitting: boolean;
  chk_corrosion: boolean;
  chk_sealing_surfaces: boolean;
  chk_makeup_feel: boolean;
  chk_bore_retainer: boolean;
  chk_general_damage: boolean;
  status: ItemStatus;
  note: string;
}

function newItem(): InspItem {
  return {
    client_key: Math.random().toString(36).slice(2),
    component_category: COMPONENT_CATEGORIES[0],
    component_name: '',
    chk_threads: false,
    chk_pitting: false,
    chk_corrosion: false,
    chk_sealing_surfaces: false,
    chk_makeup_feel: false,
    chk_bore_retainer: false,
    chk_general_damage: false,
    status: 'pass',
    note: '',
  };
}

// Roll a per-item status up to the inspection's overall status (worst wins).
function worstStatus(items: InspItem[]): string {
  const rank: Record<string, number> = { pass: 0, monitor: 1, replace_soon: 2, remove: 3 };
  let worst = 'pass';
  for (const it of items) {
    if ((rank[it.status] ?? 0) > (rank[worst] ?? 0)) worst = it.status;
  }
  return worst;
}

export default function HardwareInspection() {
  const { visitId } = useParams<{ visitId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { accessToken } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [visit, setVisit] = useState<any>(null);
  const [inspectionId, setInspectionId] = useState<string | null>(null);
  const [inspector, setInspector] = useState('');
  const [inspectionDate, setInspectionDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<InspItem[]>([]);
  const [catalog, setCatalog] = useState<string[]>([]);

  // ── Load the field visit, existing inspection (if any), and parts catalog ─────
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!visitId) return;
      setLoading(true);
      try {
        // Field visit (for header context). field-visits getAll then find by
        // field_visit_id OR row_id — matches how detail pages resolve.
        const all = await fieldVisitApi.getAll(accessToken ?? undefined);
        const v = (Array.isArray(all) ? all : []).find(
          (x: any) => String(x.field_visit_id) === String(visitId) || x.row_id === visitId
        );
        if (alive) setVisit(v || null);

        // Catalog (non-blocking).
        hardwareInspectionApi.getComponents(accessToken ?? undefined)
          .then((res: any) => { if (alive) setCatalog(res?.components || []); })
          .catch(() => {});

        // Existing inspection for this visit.
        const fvId = v?.field_visit_id ?? visitId;
        const existing = await hardwareInspectionApi.getByVisit(
          String(fvId), accessToken ?? undefined
        );
        if (alive && existing && existing.row_id) {
          setInspectionId(existing.row_id);
          setInspector(existing.inspector || v?.xc_rep || '');
          setInspectionDate(
            (existing.inspection_date || '').slice(0, 10) ||
            new Date().toISOString().slice(0, 10)
          );
          setNotes(existing.notes || '');
          const loaded: InspItem[] = (existing.items || []).map((it: any) => ({
            client_key: it.row_id || Math.random().toString(36).slice(2),
            component_category: it.component_category || COMPONENT_CATEGORIES[0],
            component_name: it.component_name || '',
            chk_threads: !!it.chk_threads,
            chk_pitting: !!it.chk_pitting,
            chk_corrosion: !!it.chk_corrosion,
            chk_sealing_surfaces: !!it.chk_sealing_surfaces,
            chk_makeup_feel: !!it.chk_makeup_feel,
            chk_bore_retainer: !!it.chk_bore_retainer,
            chk_general_damage: !!it.chk_general_damage,
            status: (ITEM_STATUSES.includes(it.status) ? it.status : 'pass') as ItemStatus,
            note: it.note || '',
          }));
          setItems(loaded.length ? loaded : [newItem()]);
        } else if (alive) {
          setInspector(v?.xc_rep || '');
          setItems([newItem()]);
        }
      } catch (e) {
        console.error('Failed to load hardware inspection', e);
        if (alive) { setItems([newItem()]); }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visitId]);

  const fvId = visit?.field_visit_id ?? visitId ?? '';

  const setItem = useCallback((key: string, patch: Partial<InspItem>) => {
    setItems((prev) => prev.map((it) => (it.client_key === key ? { ...it, ...patch } : it)));
  }, []);

  function addItem() {
    setItems((prev) => [...prev, newItem()]);
  }
  function removeItem(key: string) {
    setItems((prev) => prev.filter((it) => it.client_key !== key));
  }

  function catalogFor(category: string): string[] {
    const kws = CATEGORY_KEYWORDS[category] || [];
    if (!kws.length) return catalog;
    return catalog.filter((name) => {
      const lower = name.toLowerCase();
      return kws.some((kw) => lower.includes(kw));
    });
  }

  const overall = useMemo(() => worstStatus(items), [items]);

  // ── Save: upsert the inspection, then replace its line items ─────────────────
  async function handleSave() {
    if (!fvId) {
      toast.error('Missing field visit reference.');
      return;
    }
    setSaving(true);
    try {
      const header = {
        field_visit_id: String(fvId),
        customer: visit?.customer ?? null,
        customer_district: visit?.customer_district ?? null,
        inspector: inspector || null,
        inspection_date: inspectionDate ? new Date(inspectionDate + 'T12:00:00').toISOString() : null,
        overall_status: worstStatus(items),
        notes: notes || null,
        updated_by: inspector || null,
      };

      let id = inspectionId;
      if (id) {
        await hardwareInspectionApi.update(id, header, accessToken ?? undefined);
      } else {
        const created = await hardwareInspectionApi.create(header, accessToken ?? undefined);
        id = created?.row_id;
        if (!id) throw new Error('Could not create inspection record.');
        setInspectionId(id);
      }

      const payloadItems = items.map((it, idx) => ({
        component_category: it.component_category,
        component_name: it.component_name || null,
        chk_threads: it.chk_threads,
        chk_pitting: it.chk_pitting,
        chk_corrosion: it.chk_corrosion,
        chk_sealing_surfaces: it.chk_sealing_surfaces,
        chk_makeup_feel: it.chk_makeup_feel,
        chk_bore_retainer: it.chk_bore_retainer,
        chk_general_damage: it.chk_general_damage,
        status: it.status,
        note: it.note || null,
        sort_order: idx,
      }));
      await hardwareInspectionApi.saveItems(id, payloadItems, accessToken ?? undefined);

      toast.success('Hardware inspection saved.');
    } catch (e: any) {
      console.error('Save failed', e);
      toast.error(e?.message || 'Failed to save inspection.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-gray-500">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading inspection…
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-1.5">
            <ArrowLeft className="w-4 h-4" /> Back
          </Button>
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <Wrench className="w-5 h-5 text-gray-500" />
              Hardware Inspection
            </h1>
            <p className="text-sm text-gray-500">
              {[
                visit?.field_visit_id ? `Field Visit #${visit.field_visit_id}` : null,
                visit?.customerName || null,
                visit?.districtName || null,
              ].filter(Boolean).join(' · ') || 'Reusable hardware wear check'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={STATUS_BADGE[overall]}>
            {overall === 'pass' ? (
              <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
            ) : (
              <AlertTriangle className="w-3.5 h-3.5 mr-1" />
            )}
            Overall: {STATUS_LABEL[overall]}
          </Badge>
          <Button onClick={handleSave} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? 'Saving…' : 'Save inspection'}
          </Button>
        </div>
      </div>

      {/* Inspection meta */}
      <Card className="rounded-xl">
        <CardHeader><CardTitle className="text-base">Inspection details</CardTitle></CardHeader>
        <CardContent className="grid sm:grid-cols-3 gap-4">
          <div className="flex flex-col gap-1">
            <Label className="text-xs uppercase tracking-wide text-gray-500">Inspector (SQM)</Label>
            <Input value={inspector} onChange={(e) => setInspector(e.target.value)} placeholder="Name" />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs uppercase tracking-wide text-gray-500">Inspection date</Label>
            <Input type="date" value={inspectionDate} onChange={(e) => setInspectionDate(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1 sm:col-span-1">
            <Label className="text-xs uppercase tracking-wide text-gray-500">Components checked</Label>
            <div className="text-sm text-gray-700 dark:text-gray-200 py-2">{items.length}</div>
          </div>
        </CardContent>
      </Card>

      {/* Component line items */}
      <div className="space-y-4">
        {items.map((it, idx) => {
          const flaggedCount = CHECK_DEFS.filter((c) => (it as any)[c.key]).length;
          return (
            <Card key={it.client_key} className="rounded-xl">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    Component {idx + 1}
                    {flaggedCount > 0 && (
                      <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                        {flaggedCount} issue{flaggedCount > 1 ? 's' : ''} flagged
                      </Badge>
                    )}
                    <Badge variant="outline" className={STATUS_BADGE[it.status]}>
                      {STATUS_LABEL[it.status]}
                    </Badge>
                  </CardTitle>
                  <Button
                    variant="ghost" size="sm"
                    className="text-red-500 hover:text-red-600 gap-1"
                    onClick={() => removeItem(it.client_key)}
                    disabled={items.length <= 1}
                  >
                    <Trash2 className="w-4 h-4" /> Remove
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Category + specific part */}
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs uppercase tracking-wide text-gray-500">Category</Label>
                    <select
                      className="border rounded-md px-3 py-2 text-sm bg-white dark:bg-gray-900"
                      value={it.component_category}
                      onChange={(e) => setItem(it.client_key, { component_category: e.target.value, component_name: '' })}
                    >
                      {COMPONENT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs uppercase tracking-wide text-gray-500">
                      Specific part (optional)
                    </Label>
                    <input
                      list={`catalog-${it.client_key}`}
                      className="border rounded-md px-3 py-2 text-sm bg-white dark:bg-gray-900"
                      value={it.component_name}
                      onChange={(e) => setItem(it.client_key, { component_name: e.target.value })}
                      placeholder="Start typing or pick from catalog…"
                    />
                    <datalist id={`catalog-${it.client_key}`}>
                      {catalogFor(it.component_category).slice(0, 200).map((name) => (
                        <option key={name} value={name} />
                      ))}
                    </datalist>
                  </div>
                </div>

                {/* Wear checks */}
                <div>
                  <Label className="text-xs uppercase tracking-wide text-gray-500">
                    Wear checks — tick any issue found
                  </Label>
                  <div className="grid sm:grid-cols-2 gap-2 mt-2">
                    {CHECK_DEFS.map((c) => {
                      const checked = (it as any)[c.key] as boolean;
                      return (
                        <label
                          key={c.key}
                          className={`flex items-start gap-2 rounded-md border p-2.5 cursor-pointer transition-colors ${
                            checked
                              ? 'border-amber-300 bg-amber-50 dark:bg-amber-950/20'
                              : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50'
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            checked={checked}
                            onChange={(e) => setItem(it.client_key, { [c.key]: e.target.checked } as Partial<InspItem>)}
                          />
                          <span className="min-w-0">
                            <span className="block text-sm font-medium text-gray-900 dark:text-gray-100">{c.label}</span>
                            <span className="block text-xs text-gray-500">{c.hint}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* Status + note */}
                <div className="grid sm:grid-cols-3 gap-4">
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs uppercase tracking-wide text-gray-500">Condition</Label>
                    <select
                      className="border rounded-md px-3 py-2 text-sm bg-white dark:bg-gray-900"
                      value={it.status}
                      onChange={(e) => setItem(it.client_key, { status: e.target.value as ItemStatus })}
                    >
                      {ITEM_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1 sm:col-span-2">
                    <Label className="text-xs uppercase tracking-wide text-gray-500">Note (optional)</Label>
                    <Textarea
                      rows={2}
                      value={it.note}
                      onChange={(e) => setItem(it.client_key, { note: e.target.value })}
                      placeholder="Anything notable about this component…"
                    />
                  </div>
                </div>

                {/* Photos — attach to the inspection, tagged per component.
                    Available once the inspection has been saved (needs a row id). */}
                {inspectionId ? (
                  <div>
                    <Label className="text-xs uppercase tracking-wide text-gray-500">Photos</Label>
                    <div className="mt-2">
                      <ImageUpload
                        parentTable="hardware_inspections"
                        parentRowId={inspectionId}
                        fieldName={`component_${idx + 1}`}
                        baseUrl={baseUrl}
                        publicAnonKey={publicAnonKey}
                        autoLoad
                        maxImages={6}
                      />
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 italic">
                    Save the inspection to attach photos to this component.
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}

        <Button variant="outline" onClick={addItem} className="gap-1.5">
          <Plus className="w-4 h-4" /> Add component
        </Button>
      </div>

      {/* Overall notes */}
      <Card className="rounded-xl">
        <CardHeader><CardTitle className="text-base">Overall notes</CardTitle></CardHeader>
        <CardContent>
          <Textarea
            rows={4}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Summary of the inspection, follow-up actions, parts to order…"
          />
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} className="gap-1.5">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'Saving…' : 'Save inspection'}
        </Button>
      </div>
    </div>
  );
}
