/**
 * Scheduler.tsx
 * Upcoming SQM training visits + panel install needs.
 *
 * Two views:
 *   • Calendar (default) — month grid (react-day-picker via shadcn Calendar)
 *     with colored dots per day (blue = trainings, amber = panel needs).
 *     Clicking a day lists that day's items below.
 *   • List — Upcoming Trainings + Panel Needs as sortable tables with filters.
 *
 * Dates are naive wall-clock `date` values; parse 'YYYY-MM-DD' with explicit
 * local parts so a stored date never shifts a day across timezones.
 */
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../lib/auth-context';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '../components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '../components/ui/alert-dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '../components/ui/table';
import { Calendar } from '../components/ui/calendar';
import { Combobox } from '../components/ui/combobox';
import {
  CalendarClock, Plus, Edit, Trash, GraduationCap, Cpu, ArrowUpDown, Link2,
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import {
  listScheduledTrainings, createScheduledTraining, updateScheduledTraining, deleteScheduledTraining,
  listPanelInstallNeeds, createPanelInstallNeed, updatePanelInstallNeed, deletePanelInstallNeed,
  listSqms, listCustomers, listDistrictsForCustomer, listDistrictsByIds, listEpCompanies, listProductLines,
  PANEL_TYPES, TRAINING_STATUSES, PANEL_NEED_STATUSES, SCHEDULER_CATEGORIES,
} from '../lib/scheduler';

// ── Date helpers (timezone-safe, naive wall-clock) ────────────────────────────
function parseLocalDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = String(s).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
function dayKey(d: Date): string {
  return format(d, 'yyyy-MM-dd');
}
function prettyDate(s: string | null | undefined): string {
  const d = parseLocalDate(s);
  return d ? format(d, 'EEE, MMM d, yyyy') : '—';
}

// ── Shared form field wrapper ─────────────────────────────────────────────────
function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1 block">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </Label>
      {children}
    </div>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  const s = (status || 'planned').toLowerCase();
  const cls =
    s === 'completed' || s === 'fulfilled'
      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
      : s === 'cancelled'
      ? 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
      : 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300';
  return <span className={`inline-block rounded-md px-2 py-0.5 text-xs font-medium capitalize ${cls}`}>{s}</span>;
}

function CategoryBadge({ category }: { category: string | null }) {
  if (!category) return null;
  return (
    <span className="inline-block rounded-md px-2 py-0.5 text-xs font-medium bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300">
      {category}
    </span>
  );
}

function LinkIndicator({ label }: { label: string | null }) {
  if (!label) return null;
  return (
    <span
      title={`Linked to ${label}`}
      className="inline-flex items-center text-indigo-500 dark:text-indigo-400 align-middle"
      aria-label={`Linked to ${label}`}
    >
      <Link2 className="w-3.5 h-3.5" />
    </span>
  );
}

const selectCls =
  'w-full h-9 rounded-md border border-input bg-input-background px-3 text-sm dark:bg-input/30 ' +
  'text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 outline-none';

// ── Training create/edit dialog ───────────────────────────────────────────────
function TrainingFormDialog({
  open, onClose, onSaved, record, currentUser, panelNeeds, custLabel,
}: {
  open: boolean; onClose: () => void; onSaved: () => void; record: any; currentUser: any;
  panelNeeds: any[]; custLabel: (id: string | null) => string;
}) {
  const editing = !!record;
  const [sqms, setSqms] = useState<{ name: string; email: string | null }[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [districts, setDistricts] = useState<any[]>([]);
  const [epCompanies, setEpCompanies] = useState<string[]>([]);
  const [productLines, setProductLines] = useState<string[]>([]);

  const [sqmName, setSqmName] = useState('');
  const [custId, setCustId] = useState('');
  const [distId, setDistId] = useState('');
  const [opCompany, setOpCompany] = useState('');
  const [productLine, setProductLine] = useState('');
  const [plannedDate, setPlannedDate] = useState('');
  const [status, setStatus] = useState('planned');
  const [category, setCategory] = useState('');
  const [linkPanelId, setLinkPanelId] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    Promise.all([listSqms(), listCustomers(), listEpCompanies(), listProductLines()])
      .then(([s, c, e, p]) => { setSqms(s); setCustomers(c); setEpCompanies(e); setProductLines(p); });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setSqmName(record?.sqm_name || '');
    setCustId(record?.customer || '');
    setDistId(record?.customer_district || '');
    setOpCompany(record?.operating_company || '');
    setProductLine(record?.product_line || '');
    setPlannedDate(record?.planned_date ? String(record.planned_date).slice(0, 10) : '');
    setStatus(record?.status || 'planned');
    setCategory(record?.category || '');
    setLinkPanelId(record?.linked_panel_need_id || '');
    setNotes(record?.notes || '');
  }, [open, record]);

  useEffect(() => {
    if (!custId) { setDistricts([]); return; }
    listDistrictsForCustomer(custId).then(setDistricts);
  }, [custId]);

  const handleSave = async () => {
    if (!plannedDate) { toast.error('Planned date is required.'); return; }
    if (!sqmName.trim() && !custId) { toast.error('Enter an SQM or select a customer.'); return; }
    const sqmEmail = sqms.find((s) => s.name === sqmName)?.email ?? null;
    const newPanelId = linkPanelId || null;
    const oldPanelId = record?.linked_panel_need_id || null;
    const payload: any = {
      sqm_name: sqmName.trim() || null,
      sqm_email: sqmEmail,
      customer: custId || null,
      customer_district: distId || null,
      operating_company: opCompany || null,
      product_line: productLine || null,
      planned_date: plannedDate,
      status,
      category: category || null,
      linked_panel_need_id: newPanelId,
      notes: notes.trim() || null,
    };
    setSaving(true);
    try {
      const saved = editing
        ? await updateScheduledTraining(record.id, payload)
        : await createScheduledTraining({ ...payload, created_by: currentUser?.name || currentUser?.email || null });
      const trainingId = saved?.id || record?.id;
      // Keep the reciprocal link on the panel need in sync (best-effort).
      try {
        if (oldPanelId && oldPanelId !== newPanelId) {
          await updatePanelInstallNeed(oldPanelId, { linked_training_id: null });
        }
        if (newPanelId && trainingId) {
          await updatePanelInstallNeed(newPanelId, { linked_training_id: trainingId });
        }
      } catch {
        toast.error('Training saved, but failed to sync the linked panel need.');
      }
      toast.success(`Training ${editing ? 'updated' : 'scheduled'} successfully`);
      onSaved();
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save training');
    } finally {
      setSaving(false);
    }
  };

  const panelLinkOptions = useMemo(() => {
    const opts = panelNeeds
      .filter((p) => (p.status || 'open') !== 'cancelled' || p.id === linkPanelId)
      .map((p) => ({
        value: p.id,
        label: `${p.panel_type || 'Panel'} — ${custLabel(p.customer)}${p.needed_by_date ? ` (needed ${String(p.needed_by_date).slice(0, 10)})` : ''}`,
      }));
    return opts;
  }, [panelNeeds, linkPanelId, custLabel]);

  const sqmOptions = useMemo(() => {
    const names = sqms.map((s) => s.name);
    if (sqmName && !names.includes(sqmName)) names.unshift(sqmName);
    return names.map((n) => ({ value: n, label: n }));
  }, [sqms, sqmName]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl w-[95vw] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit Training Visit' : 'Add Training Visit'}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 mt-2">
          <Field label="Planned Date" required>
            <Input type="date" value={plannedDate} onChange={(e) => setPlannedDate(e.target.value)} />
          </Field>

          <Field label="SQM">
            {sqms.length > 0 ? (
              <Combobox
                value={sqmName}
                onValueChange={setSqmName}
                options={sqmOptions}
                placeholder="— Select or type SQM —"
                searchPlaceholder="Search SQMs…"
                emptyText="No SQMs found."
                allowClear
              />
            ) : (
              <Input value={sqmName} onChange={(e) => setSqmName(e.target.value)} placeholder="SQM name" />
            )}
          </Field>

          <Field label="Customer">
            <Combobox
              value={custId}
              onValueChange={(v) => { setCustId(v); setDistId(''); }}
              options={customers.map((c) => ({ value: c.row_id, label: c.customer }))}
              placeholder="— Select customer —"
              searchPlaceholder="Search customers…"
              emptyText="No customers found."
              allowClear
            />
          </Field>

          <Field label="District">
            <Combobox
              value={distId}
              onValueChange={setDistId}
              disabled={!custId}
              options={districts.map((d) => ({ value: d.row_id, label: d.customer_district }))}
              placeholder="— Select district —"
              searchPlaceholder="Search districts…"
              emptyText="No districts found."
              allowClear
            />
          </Field>

          <Field label="Operating Company">
            <Combobox
              value={opCompany}
              onValueChange={setOpCompany}
              options={(opCompany && !epCompanies.includes(opCompany) ? [opCompany, ...epCompanies] : epCompanies)
                .map((o) => ({ value: o, label: o }))}
              placeholder="— Select —"
              searchPlaceholder="Search operating companies…"
              emptyText="No operating companies found."
              allowClear
            />
          </Field>

          <Field label="Product Line">
            <Combobox
              value={productLine}
              onValueChange={setProductLine}
              options={(productLine && !productLines.includes(productLine) ? [productLine, ...productLines] : productLines)
                .map((o) => ({ value: o, label: o }))}
              placeholder="— Select —"
              searchPlaceholder="Search product lines…"
              emptyText="No product lines found."
              allowClear
            />
          </Field>

          <Field label="Status">
            <select className={selectCls} value={status} onChange={(e) => setStatus(e.target.value)}>
              {TRAINING_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>

          <Field label="Category">
            <Combobox
              value={category}
              onValueChange={setCategory}
              options={SCHEDULER_CATEGORIES.map((c) => ({ value: c, label: c }))}
              placeholder="— Select —"
              searchPlaceholder="Search categories…"
              emptyText="No categories found."
              allowClear
            />
          </Field>

          <Field label="Link to Panel Need">
            <Combobox
              value={linkPanelId}
              onValueChange={setLinkPanelId}
              options={panelLinkOptions}
              placeholder="— Select —"
              searchPlaceholder="Search panel needs…"
              emptyText="No panel needs found."
              allowClear
            />
          </Field>

          <div className="md:col-span-2">
            <Field label="Notes">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Optional notes" />
            </Field>
          </div>
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : (editing ? 'Save' : 'Add Training')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Panel need create/edit dialog ─────────────────────────────────────────────
function PanelNeedFormDialog({
  open, onClose, onSaved, record, currentUser, trainings, custLabel,
}: {
  open: boolean; onClose: () => void; onSaved: () => void; record: any; currentUser: any;
  trainings: any[]; custLabel: (id: string | null) => string;
}) {
  const editing = !!record;
  const [customers, setCustomers] = useState<any[]>([]);
  const [districts, setDistricts] = useState<any[]>([]);
  const [epCompanies, setEpCompanies] = useState<string[]>([]);

  const [custId, setCustId] = useState('');
  const [distId, setDistId] = useState('');
  const [opCompany, setOpCompany] = useState('');
  const [panelType, setPanelType] = useState('');
  const [qty, setQty] = useState('1');
  const [neededBy, setNeededBy] = useState('');
  const [status, setStatus] = useState('open');
  const [category, setCategory] = useState('');
  const [linkTrainingId, setLinkTrainingId] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    Promise.all([listCustomers(), listEpCompanies()]).then(([c, e]) => { setCustomers(c); setEpCompanies(e); });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setCustId(record?.customer || '');
    setDistId(record?.customer_district || '');
    setOpCompany(record?.operating_company || '');
    setPanelType(record?.panel_type || '');
    setQty(record?.qty_needed != null ? String(record.qty_needed) : '1');
    setNeededBy(record?.needed_by_date ? String(record.needed_by_date).slice(0, 10) : '');
    setStatus(record?.status || 'open');
    setCategory(record?.category || '');
    setLinkTrainingId(record?.linked_training_id || '');
    setNotes(record?.notes || '');
  }, [open, record]);

  useEffect(() => {
    if (!custId) { setDistricts([]); return; }
    listDistrictsForCustomer(custId).then(setDistricts);
  }, [custId]);

  const handleSave = async () => {
    if (!panelType) { toast.error('Panel type is required.'); return; }
    if (!neededBy) { toast.error('Needed-by date is required.'); return; }
    if (!custId) { toast.error('Customer is required.'); return; }
    const qtyNum = parseInt(qty, 10);
    const newTrainingId = linkTrainingId || null;
    const oldTrainingId = record?.linked_training_id || null;
    const payload: any = {
      customer: custId,
      customer_district: distId || null,
      operating_company: opCompany || null,
      panel_type: panelType,
      qty_needed: isNaN(qtyNum) || qtyNum < 1 ? 1 : qtyNum,
      needed_by_date: neededBy,
      status,
      category: category || null,
      linked_training_id: newTrainingId,
      notes: notes.trim() || null,
    };
    setSaving(true);
    try {
      const saved = editing
        ? await updatePanelInstallNeed(record.id, payload)
        : await createPanelInstallNeed({ ...payload, created_by: currentUser?.name || currentUser?.email || null });
      const panelId = saved?.id || record?.id;
      // Keep the reciprocal link on the training visit in sync (best-effort).
      try {
        if (oldTrainingId && oldTrainingId !== newTrainingId) {
          await updateScheduledTraining(oldTrainingId, { linked_panel_need_id: null });
        }
        if (newTrainingId && panelId) {
          await updateScheduledTraining(newTrainingId, { linked_panel_need_id: panelId });
        }
      } catch {
        toast.error('Panel need saved, but failed to sync the linked training.');
      }
      toast.success(`Panel need ${editing ? 'updated' : 'added'} successfully`);
      onSaved();
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save panel need');
    } finally {
      setSaving(false);
    }
  };

  const trainingLinkOptions = useMemo(() => {
    return trainings
      .filter((t) => (t.status || 'planned') !== 'cancelled' || t.id === linkTrainingId)
      .map((t) => ({
        value: t.id,
        label: `${t.sqm_name || 'Training'} — ${custLabel(t.customer)}${t.planned_date ? ` (${String(t.planned_date).slice(0, 10)})` : ''}`,
      }));
  }, [trainings, linkTrainingId, custLabel]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl w-[95vw] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit Panel Need' : 'Add Panel Need'}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 mt-2">
          <Field label="Needed By" required>
            <Input type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />
          </Field>

          <Field label="Panel Type" required>
            <Combobox
              value={panelType}
              onValueChange={setPanelType}
              options={PANEL_TYPES.map((p) => ({ value: p, label: p }))}
              placeholder="— Select panel type —"
              searchPlaceholder="Search panel types…"
              emptyText="No panel types found."
            />
          </Field>

          <Field label="Customer" required>
            <Combobox
              value={custId}
              onValueChange={(v) => { setCustId(v); setDistId(''); }}
              options={customers.map((c) => ({ value: c.row_id, label: c.customer }))}
              placeholder="— Select customer —"
              searchPlaceholder="Search customers…"
              emptyText="No customers found."
            />
          </Field>

          <Field label="District">
            <Combobox
              value={distId}
              onValueChange={setDistId}
              disabled={!custId}
              options={districts.map((d) => ({ value: d.row_id, label: d.customer_district }))}
              placeholder="— Select district —"
              searchPlaceholder="Search districts…"
              emptyText="No districts found."
              allowClear
            />
          </Field>

          <Field label="Operating Company">
            <Combobox
              value={opCompany}
              onValueChange={setOpCompany}
              options={(opCompany && !epCompanies.includes(opCompany) ? [opCompany, ...epCompanies] : epCompanies)
                .map((o) => ({ value: o, label: o }))}
              placeholder="— Select —"
              searchPlaceholder="Search operating companies…"
              emptyText="No operating companies found."
              allowClear
            />
          </Field>

          <Field label="Quantity Needed">
            <Input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
          </Field>

          <Field label="Status">
            <select className={selectCls} value={status} onChange={(e) => setStatus(e.target.value)}>
              {PANEL_NEED_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>

          <Field label="Category">
            <Combobox
              value={category}
              onValueChange={setCategory}
              options={SCHEDULER_CATEGORIES.map((c) => ({ value: c, label: c }))}
              placeholder="— Select —"
              searchPlaceholder="Search categories…"
              emptyText="No categories found."
              allowClear
            />
          </Field>

          <Field label="Link to Training">
            <Combobox
              value={linkTrainingId}
              onValueChange={setLinkTrainingId}
              options={trainingLinkOptions}
              placeholder="— Select —"
              searchPlaceholder="Search trainings…"
              emptyText="No trainings found."
              allowClear
            />
          </Field>

          <div className="md:col-span-2">
            <Field label="Notes">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Optional notes" />
            </Field>
          </div>
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : (editing ? 'Save' : 'Add Panel Need')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
type SortDir = 'asc' | 'desc';

export default function Scheduler() {
  const { user } = useAuth();

  const [view, setView] = useState<'calendar' | 'list'>('calendar');
  const [trainings, setTrainings] = useState<any[]>([]);
  const [panelNeeds, setPanelNeeds] = useState<any[]>([]);
  const [custNames, setCustNames] = useState<Record<string, string>>({});
  const [distNames, setDistNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const [month, setMonth] = useState<Date>(new Date());
  const [selectedDay, setSelectedDay] = useState<Date | undefined>(new Date());

  const [trainingDialog, setTrainingDialog] = useState(false);
  const [panelDialog, setPanelDialog] = useState(false);
  const [editingTraining, setEditingTraining] = useState<any>(null);
  const [editingPanel, setEditingPanel] = useState<any>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ kind: 'training' | 'panel'; row: any } | null>(null);

  const [trainingStatusFilter, setTrainingStatusFilter] = useState('all');
  const [panelStatusFilter, setPanelStatusFilter] = useState('all');
  const [trainingSort, setTrainingSort] = useState<SortDir>('asc');
  const [panelSort, setPanelSort] = useState<SortDir>('asc');

  const loadData = async () => {
    setLoading(true);
    try {
      const [t, p, custs] = await Promise.all([
        listScheduledTrainings(), listPanelInstallNeeds(), listCustomers(),
      ]);
      setTrainings(t);
      setPanelNeeds(p);
      const cmap: Record<string, string> = {};
      for (const c of custs) cmap[c.row_id] = c.customer;
      setCustNames(cmap);
      const distIds = [...t, ...p].map((r) => r.customer_district).filter(Boolean);
      const dists = await listDistrictsByIds(distIds);
      const dmap: Record<string, string> = {};
      for (const d of dists) dmap[d.row_id] = d.customer_district;
      setDistNames(dmap);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to load scheduler data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const custLabel = (id: string | null) => (id ? (custNames[id] || id) : '—');
  const distLabel = (id: string | null) => (id ? (distNames[id] || id) : '');
  const custDistLabel = (cid: string | null, did: string | null) => {
    const c = custLabel(cid);
    const d = distLabel(did);
    return d ? `${c} · ${d}` : c;
  };

  // Lookups so a linked record can be named from either side.
  const panelById = useMemo(() => {
    const m: Record<string, any> = {};
    for (const p of panelNeeds) m[p.id] = p;
    return m;
  }, [panelNeeds]);
  const trainingById = useMemo(() => {
    const m: Record<string, any> = {};
    for (const t of trainings) m[t.id] = t;
    return m;
  }, [trainings]);

  // Counterpart label for a training's linked panel need / a panel's linked training.
  const linkedPanelLabel = (t: any): string | null => {
    const p = t?.linked_panel_need_id ? panelById[t.linked_panel_need_id] : null;
    if (!p) return null;
    return `${p.panel_type || 'Panel'} — ${custLabel(p.customer)}`;
  };
  const linkedTrainingLabel = (p: any): string | null => {
    const t = p?.linked_training_id ? trainingById[p.linked_training_id] : null;
    if (!t) return null;
    return `${t.sqm_name || 'Training'} — ${custLabel(t.customer)}`;
  };

  // Map of day-key → events for calendar dots + side panel.
  const trainingByDay = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const t of trainings) {
      const d = parseLocalDate(t.planned_date);
      if (!d) continue;
      const k = dayKey(d);
      (m.get(k) || m.set(k, []).get(k))!.push(t);
    }
    return m;
  }, [trainings]);

  const panelByDay = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const p of panelNeeds) {
      const d = parseLocalDate(p.needed_by_date);
      if (!d) continue;
      const k = dayKey(d);
      (m.get(k) || m.set(k, []).get(k))!.push(p);
    }
    return m;
  }, [panelNeeds]);

  // Custom day cell: number + colored dots (blue=training, amber=panel need).
  const DayContent = useMemo(() => {
    function DayContentInner(props: { date: Date }) {
      const k = dayKey(props.date);
      const hasT = trainingByDay.has(k);
      const hasP = panelByDay.has(k);
      return (
        <div className="relative flex h-full w-full items-center justify-center">
          <span>{props.date.getDate()}</span>
          {(hasT || hasP) && (
            <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 flex gap-0.5">
              {hasT && <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />}
              {hasP && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />}
            </span>
          )}
        </div>
      );
    }
    return DayContentInner;
  }, [trainingByDay, panelByDay]);

  const selectedKey = selectedDay ? dayKey(selectedDay) : '';
  const selectedTrainings = trainingByDay.get(selectedKey) || [];
  const selectedPanels = panelByDay.get(selectedKey) || [];

  const openEditTraining = (row: any) => { setEditingTraining(row); setTrainingDialog(true); };
  const openEditPanel = (row: any) => { setEditingPanel(row); setPanelDialog(true); };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      if (deleteTarget.kind === 'training') await deleteScheduledTraining(deleteTarget.row.id);
      else await deletePanelInstallNeed(deleteTarget.row.id);
      toast.success('Deleted successfully');
      setDeleteTarget(null);
      loadData();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to delete');
    }
  };

  const quickStatusTraining = async (row: any, next: string) => {
    try { await updateScheduledTraining(row.id, { status: next }); loadData(); }
    catch (err: any) { toast.error(err?.message || 'Failed to update status'); }
  };
  const quickStatusPanel = async (row: any, next: string) => {
    try { await updatePanelInstallNeed(row.id, { status: next }); loadData(); }
    catch (err: any) { toast.error(err?.message || 'Failed to update status'); }
  };

  const filteredTrainings = useMemo(() => {
    let rows = trainings;
    if (trainingStatusFilter !== 'all') rows = rows.filter((r) => (r.status || 'planned') === trainingStatusFilter);
    return [...rows].sort((a, b) => {
      const cmp = String(a.planned_date || '').localeCompare(String(b.planned_date || ''));
      return trainingSort === 'asc' ? cmp : -cmp;
    });
  }, [trainings, trainingStatusFilter, trainingSort]);

  const filteredPanels = useMemo(() => {
    let rows = panelNeeds;
    if (panelStatusFilter !== 'all') rows = rows.filter((r) => (r.status || 'open') === panelStatusFilter);
    return [...rows].sort((a, b) => {
      const cmp = String(a.needed_by_date || '').localeCompare(String(b.needed_by_date || ''));
      return panelSort === 'asc' ? cmp : -cmp;
    });
  }, [panelNeeds, panelStatusFilter, panelSort]);

  return (
    <div className="p-4 md:p-8">
      <div className="max-w-[1600px] mx-auto">

        {/* ── Header ── */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <CalendarClock className="w-7 h-7" /> Scheduler
            </h1>
            <p className="text-gray-600 dark:text-gray-300 mt-2">Upcoming SQM training visits and panel install needs</p>
          </div>
          <div className="flex gap-2 w-full md:w-auto">
            <Button variant="outline" onClick={() => { setEditingTraining(null); setTrainingDialog(true); }} className="flex-1 md:flex-none">
              <Plus className="w-4 h-4 mr-2" /> Add Training
            </Button>
            <Button onClick={() => { setEditingPanel(null); setPanelDialog(true); }} className="flex-1 md:flex-none">
              <Plus className="w-4 h-4 mr-2" /> Add Panel Need
            </Button>
          </div>
        </div>

        {/* ── View toggle ── */}
        <div className="flex gap-1 mb-6 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg w-fit">
          <button
            type="button"
            onClick={() => setView('calendar')}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
              view === 'calendar'
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            Calendar
          </button>
          <button
            type="button"
            onClick={() => setView('list')}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
              view === 'list'
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            List
          </button>
        </div>

        {/* ════════════ CALENDAR VIEW ════════════ */}
        {view === 'calendar' && (
          <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-6">
            <Card>
              <CardContent className="p-4">
                <Calendar
                  mode="single"
                  month={month}
                  onMonthChange={setMonth}
                  selected={selectedDay}
                  onSelect={(d) => setSelectedDay(d ?? undefined)}
                  components={{ DayContent }}
                  className="w-full"
                />
                <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-blue-500" /> Training</span>
                  <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-500" /> Panel Need</span>
                </div>
              </CardContent>
            </Card>

            {/* Selected-day items */}
            <Card>
              <CardContent className="p-4">
                <h2 className="text-lg font-semibold text-foreground mb-3">
                  {selectedDay ? format(selectedDay, 'EEEE, MMMM d, yyyy') : 'Select a day'}
                </h2>

                {selectedTrainings.length === 0 && selectedPanels.length === 0 && (
                  <p className="text-sm text-muted-foreground py-8 text-center">No scheduled items on this day.</p>
                )}

                {selectedTrainings.length > 0 && (
                  <div className="mb-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground mb-2">
                      <GraduationCap className="w-4 h-4 text-blue-500" /> Trainings
                    </div>
                    <div className="space-y-2">
                      {selectedTrainings.map((t) => (
                        <div key={t.id} className="flex items-start justify-between gap-2 rounded-md border border-border bg-card p-3">
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-foreground truncate flex items-center gap-1.5">
                              <span className="truncate">{custDistLabel(t.customer, t.customer_district)}</span>
                              <LinkIndicator label={linkedPanelLabel(t)} />
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {t.sqm_name || 'Unassigned SQM'}{t.product_line ? ` · ${t.product_line}` : ''}
                            </div>
                            {t.category && <div className="mt-1"><CategoryBadge category={t.category} /></div>}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <StatusBadge status={t.status} />
                            <button onClick={() => openEditTraining(t)} className="text-muted-foreground hover:text-foreground" aria-label="Edit"><Edit className="w-4 h-4" /></button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedPanels.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground mb-2">
                      <Cpu className="w-4 h-4 text-amber-500" /> Panel Needs
                    </div>
                    <div className="space-y-2">
                      {selectedPanels.map((p) => (
                        <div key={p.id} className="flex items-start justify-between gap-2 rounded-md border border-border bg-card p-3">
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-foreground truncate flex items-center gap-1.5">
                              <span className="truncate">{custDistLabel(p.customer, p.customer_district)}</span>
                              <LinkIndicator label={linkedTrainingLabel(p)} />
                            </div>
                            <div className="text-xs text-muted-foreground">{p.panel_type} × {p.qty_needed ?? 1}</div>
                            {p.category && <div className="mt-1"><CategoryBadge category={p.category} /></div>}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <StatusBadge status={p.status} />
                            <button onClick={() => openEditPanel(p)} className="text-muted-foreground hover:text-foreground" aria-label="Edit"><Edit className="w-4 h-4" /></button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* ════════════ LIST VIEW ════════════ */}
        {view === 'list' && (
          <div className="space-y-8">
            {/* Upcoming Trainings */}
            <div>
              <div className="flex items-center justify-between gap-2 mb-3">
                <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                  <GraduationCap className="w-5 h-5 text-blue-500" /> Upcoming Trainings
                </h2>
                <select className="h-9 rounded-md border border-input bg-input-background px-3 text-sm dark:bg-input/30 text-foreground"
                  value={trainingStatusFilter} onChange={(e) => setTrainingStatusFilter(e.target.value)}>
                  <option value="all">All statuses</option>
                  {TRAINING_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <Card>
                <CardContent className="p-0 overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>
                          <button className="flex items-center gap-1" onClick={() => setTrainingSort((d) => d === 'asc' ? 'desc' : 'asc')}>
                            Planned Date <ArrowUpDown className="w-3 h-3" />
                          </button>
                        </TableHead>
                        <TableHead>SQM</TableHead>
                        <TableHead>Customer / District</TableHead>
                        <TableHead>Product Line</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredTrainings.length === 0 && (
                        <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No scheduled trainings.</TableCell></TableRow>
                      )}
                      {filteredTrainings.map((t) => (
                        <TableRow key={t.id}>
                          <TableCell className="whitespace-nowrap">{prettyDate(t.planned_date)}</TableCell>
                          <TableCell>{t.sqm_name || '—'}</TableCell>
                          <TableCell>
                            <span className="inline-flex items-center gap-1.5">
                              {custDistLabel(t.customer, t.customer_district)}
                              <LinkIndicator label={linkedPanelLabel(t)} />
                            </span>
                          </TableCell>
                          <TableCell>{t.product_line || '—'}</TableCell>
                          <TableCell>{t.category ? <CategoryBadge category={t.category} /> : '—'}</TableCell>
                          <TableCell>
                            <select className="h-8 rounded-md border border-input bg-input-background px-2 text-xs dark:bg-input/30 text-foreground"
                              value={t.status || 'planned'} onChange={(e) => quickStatusTraining(t, e.target.value)}>
                              {TRAINING_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                          </TableCell>
                          <TableCell className="text-right whitespace-nowrap">
                            <button onClick={() => openEditTraining(t)} className="text-muted-foreground hover:text-foreground mr-3" aria-label="Edit"><Edit className="w-4 h-4 inline" /></button>
                            <button onClick={() => setDeleteTarget({ kind: 'training', row: t })} className="text-muted-foreground hover:text-red-500" aria-label="Delete"><Trash className="w-4 h-4 inline" /></button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>

            {/* Panel Needs */}
            <div>
              <div className="flex items-center justify-between gap-2 mb-3">
                <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                  <Cpu className="w-5 h-5 text-amber-500" /> Panel Needs
                </h2>
                <select className="h-9 rounded-md border border-input bg-input-background px-3 text-sm dark:bg-input/30 text-foreground"
                  value={panelStatusFilter} onChange={(e) => setPanelStatusFilter(e.target.value)}>
                  <option value="all">All statuses</option>
                  {PANEL_NEED_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <Card>
                <CardContent className="p-0 overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>
                          <button className="flex items-center gap-1" onClick={() => setPanelSort((d) => d === 'asc' ? 'desc' : 'asc')}>
                            Needed By <ArrowUpDown className="w-3 h-3" />
                          </button>
                        </TableHead>
                        <TableHead>Customer / District</TableHead>
                        <TableHead>Panel Type</TableHead>
                        <TableHead>Qty</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredPanels.length === 0 && (
                        <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No panel needs.</TableCell></TableRow>
                      )}
                      {filteredPanels.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className="whitespace-nowrap">{prettyDate(p.needed_by_date)}</TableCell>
                          <TableCell>
                            <span className="inline-flex items-center gap-1.5">
                              {custDistLabel(p.customer, p.customer_district)}
                              <LinkIndicator label={linkedTrainingLabel(p)} />
                            </span>
                          </TableCell>
                          <TableCell>{p.panel_type || '—'}</TableCell>
                          <TableCell>{p.qty_needed ?? 1}</TableCell>
                          <TableCell>{p.category ? <CategoryBadge category={p.category} /> : '—'}</TableCell>
                          <TableCell>
                            <select className="h-8 rounded-md border border-input bg-input-background px-2 text-xs dark:bg-input/30 text-foreground"
                              value={p.status || 'open'} onChange={(e) => quickStatusPanel(p, e.target.value)}>
                              {PANEL_NEED_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                          </TableCell>
                          <TableCell className="text-right whitespace-nowrap">
                            <button onClick={() => openEditPanel(p)} className="text-muted-foreground hover:text-foreground mr-3" aria-label="Edit"><Edit className="w-4 h-4 inline" /></button>
                            <button onClick={() => setDeleteTarget({ kind: 'panel', row: p })} className="text-muted-foreground hover:text-red-500" aria-label="Delete"><Trash className="w-4 h-4 inline" /></button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {loading && <p className="text-sm text-muted-foreground mt-4">Loading…</p>}
      </div>

      {/* Dialogs */}
      <TrainingFormDialog
        open={trainingDialog}
        onClose={() => { setTrainingDialog(false); setEditingTraining(null); }}
        onSaved={loadData}
        record={editingTraining}
        currentUser={user}
        panelNeeds={panelNeeds}
        custLabel={custLabel}
      />
      <PanelNeedFormDialog
        open={panelDialog}
        onClose={() => { setPanelDialog(false); setEditingPanel(null); }}
        onSaved={loadData}
        record={editingPanel}
        currentUser={user}
        trainings={trainings}
        custLabel={custLabel}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this {deleteTarget?.kind === 'training' ? 'training' : 'panel need'}?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700 text-white">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
