/**
 * Scheduler.tsx
 * Unified scheduled visits + panel needs.
 *
 * A single record type (scheduled_visits) covers both:
 *   • on_site  — an SQM visit on a planned_date (blue on the calendar).
 *   • ship_only — panels shipped to a customer; plotted on the earliest panel
 *     needed_by_date (amber on the calendar).
 * Each visit owns zero-or-more child panels (scheduled_visit_panels).
 *
 * Two views:
 *   • Calendar (default) — month grid (react-day-picker via shadcn Calendar)
 *     with colored dots per day (blue = on-site visit, amber = panel/ship need).
 *   • List — Visits table + a flat "All Panel Needs" table (one row per panel).
 *
 * Dates are naive wall-clock `date` values; parse 'YYYY-MM-DD' with explicit
 * local parts so a stored date never shifts a day across timezones.
 */
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../lib/auth-context';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
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
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import {
  CalendarClock, Plus, Edit, Trash, Truck, MapPin, Cpu, ArrowUpDown, X,
  ExternalLink, PackageCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import {
  listScheduledVisits, createScheduledVisit, updateScheduledVisit, deleteScheduledVisit,
  markVisitShipped,
  listSqms, listCustomers, listDistrictsForCustomer, listDistrictsByIds, listEpCompanies, listProductLines,
  PANEL_TYPES, VISIT_STATUSES, SCHEDULER_CATEGORIES, FULFILLMENT_TYPES,
  ScheduledVisit, VisitPanel,
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

// Earliest panel needed_by_date for a visit (used to place ship_only on calendar).
function earliestPanelDate(v: ScheduledVisit): string | null {
  const dates = (v.panels || [])
    .map((p) => (p.needed_by_date ? String(p.needed_by_date).slice(0, 10) : null))
    .filter(Boolean) as string[];
  if (!dates.length) return null;
  return dates.sort((a, b) => a.localeCompare(b))[0];
}

// ── Shared form field wrapper ─────────────────────────────────────────────────
function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
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
    s === 'completed'
      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
      : s === 'cancelled'
      ? 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
      : s === 'confirmed'
      ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300'
      : s === 'shipped'
      ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
      : 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300';
  return <span className={`inline-block rounded-md px-2 py-0.5 text-xs font-medium capitalize ${cls}`}>{s}</span>;
}

// Shows a tracking number, hyperlinked when a tracking URL is present.
function TrackingCell({ number, url }: { number: string | null | undefined; url: string | null | undefined }) {
  const n = (number || '').trim();
  const u = (url || '').trim();
  if (!n && !u) return <span className="text-muted-foreground">—</span>;
  const label = n || 'Track';
  if (u) {
    return (
      <a href={u} target="_blank" rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline">
        {label}<ExternalLink className="w-3 h-3" />
      </a>
    );
  }
  return <span className="text-foreground">{label}</span>;
}

function ShippedBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
      <PackageCheck className="w-3 h-3" /> Shipped
    </span>
  );
}

const isShipped = (v: { status?: string | null; shipped_at?: string | null }) =>
  v.status === 'shipped' || !!v.shipped_at;

// Quick action: mark a ship-only visit shipped, optionally capturing tracking
// in a small popover. Skipping the fields just stamps status=shipped + shipped_at.
function MarkShippedButton({ visit, onDone, compact }: { visit: ScheduledVisit; onDone: () => void; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [num, setNum] = useState(visit.tracking_number || '');
  const [url, setUrl] = useState(visit.tracking_url || '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) { setNum(visit.tracking_number || ''); setUrl(visit.tracking_url || ''); }
  }, [open, visit.tracking_number, visit.tracking_url]);

  const submit = async () => {
    setBusy(true);
    try {
      await markVisitShipped(visit.id, { tracking_number: num, tracking_url: url });
      toast.success('Marked shipped');
      setOpen(false);
      onDone();
    } catch {
      // toast raised in data layer
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className={compact ? 'h-7 px-2 text-xs' : ''}>
          <Truck className={compact ? 'w-3 h-3 mr-1' : 'w-3.5 h-3.5 mr-1'} /> Mark shipped
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3">
        <div>
          <Label className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1 block">Tracking #</Label>
          <Input value={num} onChange={(e) => setNum(e.target.value)} placeholder="Optional" />
        </div>
        <div>
          <Label className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1 block">Tracking link</Label>
          <Input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
          <Button type="button" size="sm" onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Confirm'}</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function FulfillmentBadge({ type }: { type: string | null }) {
  const shipOnly = type === 'ship_only';
  const cls = shipOnly
    ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
    : 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300';
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${cls}`}>
      {shipOnly ? <Truck className="w-3 h-3" /> : <MapPin className="w-3 h-3" />}
      {shipOnly ? 'Ship-only' : 'On-site'}
    </span>
  );
}

function CategoryChips({ categories }: { categories: string[] | null }) {
  if (!categories || !categories.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {categories.map((c) => (
        <span key={c} className="inline-block rounded-md px-2 py-0.5 text-xs font-medium bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300">
          {c}
        </span>
      ))}
    </span>
  );
}

const selectCls =
  'w-full h-9 rounded-md border border-input bg-input-background px-3 text-sm dark:bg-input/30 ' +
  'text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 outline-none';

// ── Unified create/edit dialog ────────────────────────────────────────────────
type PanelRow = {
  panel_type: string;
  qty: string;
  needed_by_date: string;
  tracking_number: string;
  tracking_url: string;
  shipped_at: string | null;
  trackingOpen: boolean;
};

function VisitFormDialog({
  open, onClose, onSaved, record, currentUser,
}: {
  open: boolean; onClose: () => void; onSaved: () => void; record: ScheduledVisit | null; currentUser: any;
}) {
  const editing = !!record;
  const [sqms, setSqms] = useState<{ name: string; email: string | null }[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [districts, setDistricts] = useState<any[]>([]);
  const [epCompanies, setEpCompanies] = useState<string[]>([]);
  const [productLines, setProductLines] = useState<string[]>([]);

  const [fulfillment, setFulfillment] = useState('on_site');
  const [categories, setCategories] = useState<string[]>([]);
  const [sqmName, setSqmName] = useState('');
  const [custId, setCustId] = useState('');
  const [distId, setDistId] = useState('');
  const [opCompany, setOpCompany] = useState('');
  const [productLine, setProductLine] = useState('');
  const [plannedDate, setPlannedDate] = useState('');
  const [status, setStatus] = useState('planned');
  const [notes, setNotes] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [trackingUrl, setTrackingUrl] = useState('');
  const [panels, setPanels] = useState<PanelRow[]>([]);
  const [saving, setSaving] = useState(false);

  const shipOnly = fulfillment === 'ship_only';

  useEffect(() => {
    if (!open) return;
    Promise.all([listSqms(), listCustomers(), listEpCompanies(), listProductLines()])
      .then(([s, c, e, p]) => { setSqms(s); setCustomers(c); setEpCompanies(e); setProductLines(p); });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setFulfillment(record?.fulfillment_type || 'on_site');
    setCategories(record?.categories || []);
    setSqmName(record?.sqm_name || '');
    setCustId(record?.customer || '');
    setDistId(record?.customer_district || '');
    setOpCompany(record?.operating_company || '');
    setProductLine(record?.product_line || '');
    setPlannedDate(record?.planned_date ? String(record.planned_date).slice(0, 10) : '');
    setStatus(record?.status || 'planned');
    setNotes(record?.notes || '');
    setTrackingNumber(record?.tracking_number || '');
    setTrackingUrl(record?.tracking_url || '');
    setPanels(
      (record?.panels || []).map((p) => ({
        panel_type: p.panel_type || '',
        qty: p.qty_needed != null ? String(p.qty_needed) : '1',
        needed_by_date: p.needed_by_date ? String(p.needed_by_date).slice(0, 10) : '',
        tracking_number: p.tracking_number || '',
        tracking_url: p.tracking_url || '',
        shipped_at: p.shipped_at || null,
        trackingOpen: !!(p.tracking_number || p.tracking_url),
      })),
    );
  }, [open, record]);

  useEffect(() => {
    if (!custId) { setDistricts([]); return; }
    listDistrictsForCustomer(custId).then(setDistricts);
  }, [custId]);

  const toggleCategory = (c: string) => {
    setCategories((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  };

  const addPanel = () => setPanels((prev) => [...prev, {
    panel_type: '', qty: '1', needed_by_date: '',
    tracking_number: '', tracking_url: '', shipped_at: null, trackingOpen: false,
  }]);
  const removePanel = (idx: number) => setPanels((prev) => prev.filter((_, i) => i !== idx));
  const updatePanel = (idx: number, patch: Partial<PanelRow>) =>
    setPanels((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));

  const handleSave = async () => {
    // Validation
    if (shipOnly) {
      if (!custId) { toast.error('Customer is required for ship-only requests.'); return; }
      const valid = panels.filter((p) => p.panel_type);
      if (!valid.length) { toast.error('Add at least one panel with a panel type.'); return; }
    } else {
      if (!plannedDate) { toast.error('Planned date is required for on-site visits.'); return; }
      if (!sqmName.trim() && !custId) { toast.error('Enter an SQM or select a customer.'); return; }
    }
    if (panels.some((p) => !p.panel_type)) {
      toast.error('Every panel row must have a panel type (or remove it).');
      return;
    }

    const sqmEmail = sqms.find((s) => s.name === sqmName)?.email ?? null;
    const panelPayload: VisitPanel[] = panels
      .filter((p) => p.panel_type)
      .map((p) => {
        const q = parseInt(p.qty, 10);
        return {
          panel_type: p.panel_type,
          qty_needed: isNaN(q) || q < 1 ? 1 : q,
          needed_by_date: p.needed_by_date || null,
          tracking_number: p.tracking_number.trim() || null,
          tracking_url: p.tracking_url.trim() || null,
          shipped_at: p.shipped_at || null,
        };
      });

    const payload: Partial<ScheduledVisit> = {
      fulfillment_type: fulfillment,
      categories: shipOnly ? [] : categories,
      sqm_name: shipOnly ? null : (sqmName.trim() || null),
      sqm_email: shipOnly ? null : sqmEmail,
      customer: custId || null,
      customer_district: distId || null,
      operating_company: opCompany || null,
      product_line: shipOnly ? null : (productLine || null),
      planned_date: plannedDate || null,
      status,
      notes: notes.trim() || null,
      tracking_number: trackingNumber.trim() || null,
      tracking_url: trackingUrl.trim() || null,
    };

    setSaving(true);
    try {
      if (editing && record) {
        await updateScheduledVisit(record.id, payload, panelPayload);
      } else {
        await createScheduledVisit(
          { ...payload, created_by: currentUser?.name || currentUser?.email || null },
          panelPayload,
        );
      }
      toast.success(`Visit ${editing ? 'updated' : 'scheduled'} successfully`);
      onSaved();
      onClose();
    } catch {
      // toast already raised in data layer
    } finally {
      setSaving(false);
    }
  };

  const sqmOptions = useMemo(() => {
    const names = sqms.map((s) => s.name);
    if (sqmName && !names.includes(sqmName)) names.unshift(sqmName);
    return names.map((n) => ({ value: n, label: n }));
  }, [sqms, sqmName]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl w-[95vw] max-h-[90vh] overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit Visit' : 'Schedule Visit'}</DialogTitle>
        </DialogHeader>

        {/* Fulfillment type segmented control */}
        <div className="mt-2">
          <Label className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1 block">Fulfillment Type</Label>
          <div className="inline-flex gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg">
            {FULFILLMENT_TYPES.map((ft) => (
              <button
                key={ft.value}
                type="button"
                onClick={() => setFulfillment(ft.value)}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                  fulfillment === ft.value
                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                {ft.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 mt-4">
          <Field label="Planned Date" required={!shipOnly}>
            <Input type="date" value={plannedDate} onChange={(e) => setPlannedDate(e.target.value)} />
            {shipOnly && <p className="text-[11px] text-muted-foreground mt-1">Optional for ship-only requests.</p>}
          </Field>

          {!shipOnly && (
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
          )}

          <Field label="Customer" required={shipOnly}>
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

          {!shipOnly && (
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
          )}

          <Field label="Status">
            <select className={selectCls} value={status} onChange={(e) => setStatus(e.target.value)}>
              {VISIT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </div>

        {/* Shipping / tracking (visit-level; emphasized for ship-only) */}
        <div className="mt-4 rounded-md border border-border bg-card p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <Truck className="w-4 h-4 text-amber-500" />
            <Label className="text-xs font-semibold text-gray-600 dark:text-gray-300 block">
              Shipping {shipOnly && <span className="text-muted-foreground font-normal">(for ship-only)</span>}
            </Label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
            <Field label="Tracking #">
              <Input value={trackingNumber} onChange={(e) => setTrackingNumber(e.target.value)} placeholder="e.g. 1Z999…" />
            </Field>
            <Field label="Tracking link">
              <Input type="url" value={trackingUrl} onChange={(e) => setTrackingUrl(e.target.value)} placeholder="https://…" />
            </Field>
          </div>
        </div>

        {/* Categories (on-site only) */}
        {!shipOnly && (
          <div className="mt-4">
            <Label className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1 block">Categories</Label>
            <div className="flex flex-wrap gap-2">
              {SCHEDULER_CATEGORIES.map((c) => {
                const active = categories.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => toggleCategory(c)}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                      active
                        ? 'bg-violet-100 text-violet-800 border-violet-300 dark:bg-violet-900/40 dark:text-violet-300 dark:border-violet-700'
                        : 'bg-card text-muted-foreground border-border hover:bg-accent'
                    }`}
                  >
                    {c}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Panels (repeatable) */}
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <Label className="text-xs font-semibold text-gray-600 dark:text-gray-300 block">
              Panels{shipOnly && <span className="text-red-500 ml-0.5">*</span>}
            </Label>
            <Button type="button" variant="outline" size="sm" onClick={addPanel}>
              <Plus className="w-3.5 h-3.5 mr-1" /> Add panel
            </Button>
          </div>
          {panels.length === 0 && (
            <p className="text-xs text-muted-foreground py-2">
              {shipOnly ? 'Add at least one panel.' : 'No panels added (optional for on-site visits).'}
            </p>
          )}
          <div className="space-y-2">
            {panels.map((p, idx) => (
              <div key={idx} className="rounded-md border border-border bg-card p-2">
                <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_72px_150px_auto] gap-2 items-end">
                  <div className="min-w-0">
                    <Label className="text-[11px] text-muted-foreground mb-1 block">Panel type</Label>
                    <Combobox
                      value={p.panel_type}
                      onValueChange={(v) => updatePanel(idx, { panel_type: v })}
                      options={PANEL_TYPES.map((pt) => ({ value: pt, label: pt }))}
                      placeholder="— Select panel —"
                      searchPlaceholder="Search panel types…"
                      emptyText="No panel types found."
                    />
                  </div>
                  <div className="min-w-0">
                    <Label className="text-[11px] text-muted-foreground mb-1 block">Qty</Label>
                    <Input type="number" min={1} value={p.qty} onChange={(e) => updatePanel(idx, { qty: e.target.value })} />
                  </div>
                  <div className="min-w-0">
                    <Label className="text-[11px] text-muted-foreground mb-1 block">Needed by</Label>
                    <Input type="date" value={p.needed_by_date} onChange={(e) => updatePanel(idx, { needed_by_date: e.target.value })} />
                  </div>
                  <div className="flex items-center gap-1 justify-end">
                    <button
                      type="button"
                      onClick={() => updatePanel(idx, { trackingOpen: !p.trackingOpen })}
                      className={`h-9 w-9 flex items-center justify-center rounded-md hover:bg-accent ${
                        p.trackingOpen || p.tracking_number || p.tracking_url
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                      aria-label="Toggle panel tracking"
                      title="Tracking for this panel"
                    >
                      <Truck className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removePanel(idx)}
                      className="h-9 w-9 flex items-center justify-center rounded-md text-muted-foreground hover:text-red-500 hover:bg-accent"
                      aria-label="Remove panel"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                {p.trackingOpen && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 pt-2 border-t border-border">
                    <div className="min-w-0">
                      <Label className="text-[11px] text-muted-foreground mb-1 block">Tracking # (override)</Label>
                      <Input value={p.tracking_number} onChange={(e) => updatePanel(idx, { tracking_number: e.target.value })} placeholder="Optional" />
                    </div>
                    <div className="min-w-0">
                      <Label className="text-[11px] text-muted-foreground mb-1 block">Link</Label>
                      <Input type="url" value={p.tracking_url} onChange={(e) => updatePanel(idx, { tracking_url: e.target.value })} placeholder="https://…" />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <Field label="Notes">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Optional notes" />
          </Field>
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : (editing ? 'Save' : 'Schedule Visit')}</Button>
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
  const [visits, setVisits] = useState<ScheduledVisit[]>([]);
  const [custNames, setCustNames] = useState<Record<string, string>>({});
  const [distNames, setDistNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const [month, setMonth] = useState<Date>(new Date());
  const [selectedDay, setSelectedDay] = useState<Date | undefined>(new Date());

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingVisit, setEditingVisit] = useState<ScheduledVisit | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ScheduledVisit | null>(null);

  const [statusFilter, setStatusFilter] = useState('all');
  const [visitSort, setVisitSort] = useState<SortDir>('asc');
  const [panelTypeFilter, setPanelTypeFilter] = useState('all');
  const [panelSort, setPanelSort] = useState<SortDir>('asc');

  const loadData = async () => {
    setLoading(true);
    try {
      const [v, custs] = await Promise.all([listScheduledVisits(), listCustomers()]);
      setVisits(v);
      const cmap: Record<string, string> = {};
      for (const c of custs) cmap[c.row_id] = c.customer;
      setCustNames(cmap);
      const distIds = v.map((r) => r.customer_district).filter(Boolean) as string[];
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

  // The date a visit appears on the calendar.
  const visitCalendarDate = (v: ScheduledVisit): string | null => {
    if (v.fulfillment_type === 'ship_only') return earliestPanelDate(v) || null;
    return v.planned_date ? String(v.planned_date).slice(0, 10) : null;
  };

  // Map of day-key → visits for calendar dots + side panel.
  const visitsByDay = useMemo(() => {
    const m = new Map<string, ScheduledVisit[]>();
    for (const v of visits) {
      const ds = visitCalendarDate(v);
      const d = parseLocalDate(ds);
      if (!d) continue;
      const k = dayKey(d);
      (m.get(k) || m.set(k, []).get(k))!.push(v);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visits]);

  // Per-panel amber indicators by day (any panel needed_by_date).
  const panelDatesByDay = useMemo(() => {
    const m = new Set<string>();
    for (const v of visits) {
      for (const p of v.panels || []) {
        const d = parseLocalDate(p.needed_by_date);
        if (d) m.add(dayKey(d));
      }
    }
    return m;
  }, [visits]);

  const DayContent = useMemo(() => {
    function DayContentInner(props: { date: Date }) {
      const k = dayKey(props.date);
      const dayVisits = visitsByDay.get(k) || [];
      const hasOnSite = dayVisits.some((v) => v.fulfillment_type !== 'ship_only');
      const hasShip = dayVisits.some((v) => v.fulfillment_type === 'ship_only') || panelDatesByDay.has(k);
      return (
        <div className="relative flex h-full w-full items-center justify-center">
          <span>{props.date.getDate()}</span>
          {(hasOnSite || hasShip) && (
            <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 flex gap-0.5">
              {hasOnSite && <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />}
              {hasShip && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />}
            </span>
          )}
        </div>
      );
    }
    return DayContentInner;
  }, [visitsByDay, panelDatesByDay]);

  const selectedKey = selectedDay ? dayKey(selectedDay) : '';
  const selectedVisits = visitsByDay.get(selectedKey) || [];

  const openEdit = (row: ScheduledVisit) => { setEditingVisit(row); setDialogOpen(true); };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteScheduledVisit(deleteTarget.id);
      toast.success('Deleted successfully');
      setDeleteTarget(null);
      loadData();
    } catch {
      // toast raised in data layer
    }
  };

  const quickStatus = async (row: ScheduledVisit, next: string) => {
    try {
      await updateScheduledVisit(row.id, { status: next }, row.panels || []);
      loadData();
    } catch {
      // toast raised in data layer
    }
  };

  const filteredVisits = useMemo(() => {
    let rows = visits;
    if (statusFilter !== 'all') rows = rows.filter((r) => (r.status || 'planned') === statusFilter);
    return [...rows].sort((a, b) => {
      const cmp = String(visitCalendarDate(a) || '').localeCompare(String(visitCalendarDate(b) || ''));
      return visitSort === 'asc' ? cmp : -cmp;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visits, statusFilter, visitSort]);

  // Flat panel-demand view: one row per panel across all visits.
  const flatPanels = useMemo(() => {
    const rows: { visit: ScheduledVisit; panel: VisitPanel }[] = [];
    for (const v of visits) {
      for (const p of v.panels || []) rows.push({ visit: v, panel: p });
    }
    let filtered = rows;
    if (panelTypeFilter !== 'all') filtered = filtered.filter((r) => r.panel.panel_type === panelTypeFilter);
    return filtered.sort((a, b) => {
      const cmp = String(a.panel.needed_by_date || '').localeCompare(String(b.panel.needed_by_date || ''));
      return panelSort === 'asc' ? cmp : -cmp;
    });
  }, [visits, panelTypeFilter, panelSort]);

  return (
    <div className="p-4 md:p-8">
      <div className="max-w-[1600px] mx-auto">

        {/* ── Header ── */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <CalendarClock className="w-7 h-7" /> Scheduler
            </h1>
            <p className="text-gray-600 dark:text-gray-300 mt-2">On-site visits and panel ship-only requests</p>
          </div>
          <div className="flex gap-2 w-full md:w-auto">
            <Button onClick={() => { setEditingVisit(null); setDialogOpen(true); }} className="flex-1 md:flex-none">
              <Plus className="w-4 h-4 mr-2" /> Schedule Visit
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
                  <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-blue-500" /> On-site visit</span>
                  <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-500" /> Panel/ship need</span>
                </div>
              </CardContent>
            </Card>

            {/* Selected-day items */}
            <Card>
              <CardContent className="p-4">
                <h2 className="text-lg font-semibold text-foreground mb-3">
                  {selectedDay ? format(selectedDay, 'EEEE, MMMM d, yyyy') : 'Select a day'}
                </h2>

                {selectedVisits.length === 0 && (
                  <p className="text-sm text-muted-foreground py-8 text-center">No scheduled items on this day.</p>
                )}

                <div className="space-y-2">
                  {selectedVisits.map((v) => (
                    <div key={v.id} className="rounded-md border border-border bg-card p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center flex-wrap gap-2 mb-1">
                            <FulfillmentBadge type={v.fulfillment_type} />
                            <StatusBadge status={v.status} />
                            {isShipped(v) && <ShippedBadge />}
                          </div>
                          {v.tracking_number || v.tracking_url ? (
                            <div className="text-xs mb-1"><TrackingCell number={v.tracking_number} url={v.tracking_url} /></div>
                          ) : null}
                          <div className="text-sm font-medium text-foreground truncate">
                            {custDistLabel(v.customer, v.customer_district)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {v.fulfillment_type === 'ship_only'
                              ? 'Ship-only request'
                              : (v.sqm_name || 'Unassigned SQM')}
                            {v.product_line ? ` · ${v.product_line}` : ''}
                          </div>
                          {v.categories?.length > 0 && <div className="mt-1"><CategoryChips categories={v.categories} /></div>}
                          {(v.panels || []).length > 0 && (
                            <ul className="mt-2 space-y-0.5">
                              {(v.panels || []).map((p, i) => (
                                <li key={i} className="text-xs text-muted-foreground flex items-center gap-1.5">
                                  <Cpu className="w-3 h-3 text-amber-500 shrink-0" />
                                  {p.panel_type} × {p.qty_needed ?? 1}
                                  {p.needed_by_date ? ` · needed ${prettyDate(p.needed_by_date)}` : ''}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {v.fulfillment_type === 'ship_only' && !isShipped(v) && (
                            <MarkShippedButton visit={v} onDone={loadData} compact />
                          )}
                          <button onClick={() => openEdit(v)} className="text-muted-foreground hover:text-foreground" aria-label="Edit"><Edit className="w-4 h-4" /></button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ════════════ LIST VIEW ════════════ */}
        {view === 'list' && (
          <div className="space-y-8">
            {/* Visits */}
            <div>
              <div className="flex items-center justify-between gap-2 mb-3">
                <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                  <CalendarClock className="w-5 h-5 text-blue-500" /> Visits
                </h2>
                <select className="h-9 rounded-md border border-input bg-input-background px-3 text-sm dark:bg-input/30 text-foreground"
                  value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="all">All statuses</option>
                  {VISIT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <Card>
                <CardContent className="p-0 overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>
                          <button className="flex items-center gap-1" onClick={() => setVisitSort((d) => d === 'asc' ? 'desc' : 'asc')}>
                            Date <ArrowUpDown className="w-3 h-3" />
                          </button>
                        </TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>SQM</TableHead>
                        <TableHead>Customer / District</TableHead>
                        <TableHead>Op Company</TableHead>
                        <TableHead>Categories</TableHead>
                        <TableHead>Panels</TableHead>
                        <TableHead>Tracking</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredVisits.length === 0 && (
                        <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">No scheduled visits.</TableCell></TableRow>
                      )}
                      {filteredVisits.map((v) => (
                        <TableRow key={v.id}>
                          <TableCell className="whitespace-nowrap">{prettyDate(visitCalendarDate(v))}</TableCell>
                          <TableCell><FulfillmentBadge type={v.fulfillment_type} /></TableCell>
                          <TableCell>{v.sqm_name || '—'}</TableCell>
                          <TableCell>{custDistLabel(v.customer, v.customer_district)}</TableCell>
                          <TableCell>{v.operating_company || '—'}</TableCell>
                          <TableCell>{v.categories?.length ? <CategoryChips categories={v.categories} /> : '—'}</TableCell>
                          <TableCell>
                            {(v.panels || []).length > 0
                              ? <span className="inline-block rounded-md px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">{(v.panels || []).length} panel{(v.panels || []).length === 1 ? '' : 's'}</span>
                              : '—'}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <TrackingCell number={v.tracking_number} url={v.tracking_url} />
                              {isShipped(v) && <ShippedBadge />}
                            </div>
                          </TableCell>
                          <TableCell>
                            <select className="h-8 rounded-md border border-input bg-input-background px-2 text-xs dark:bg-input/30 text-foreground"
                              value={v.status || 'planned'} onChange={(e) => quickStatus(v, e.target.value)}>
                              {VISIT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                          </TableCell>
                          <TableCell className="text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-2">
                              {v.fulfillment_type === 'ship_only' && !isShipped(v) && (
                                <MarkShippedButton visit={v} onDone={loadData} compact />
                              )}
                              <button onClick={() => openEdit(v)} className="text-muted-foreground hover:text-foreground" aria-label="Edit"><Edit className="w-4 h-4 inline" /></button>
                              <button onClick={() => setDeleteTarget(v)} className="text-muted-foreground hover:text-red-500" aria-label="Delete"><Trash className="w-4 h-4 inline" /></button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>

            {/* All Panel Needs (flat) */}
            <div>
              <div className="flex items-center justify-between gap-2 mb-3">
                <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                  <Cpu className="w-5 h-5 text-amber-500" /> All Panel Needs
                </h2>
                <select className="h-9 rounded-md border border-input bg-input-background px-3 text-sm dark:bg-input/30 text-foreground"
                  value={panelTypeFilter} onChange={(e) => setPanelTypeFilter(e.target.value)}>
                  <option value="all">All panel types</option>
                  {PANEL_TYPES.map((p) => <option key={p} value={p}>{p}</option>)}
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
                        <TableHead>Panel Type</TableHead>
                        <TableHead>Qty</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Tracking</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {flatPanels.length === 0 && (
                        <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No panel needs.</TableCell></TableRow>
                      )}
                      {flatPanels.map(({ visit, panel }, i) => {
                        const tNum = panel.tracking_number || visit.tracking_number;
                        const tUrl = panel.tracking_url || visit.tracking_url;
                        const shipped = !!panel.shipped_at || isShipped(visit);
                        return (
                          <TableRow key={`${visit.id}-${i}`}>
                            <TableCell className="whitespace-nowrap">{prettyDate(panel.needed_by_date)}</TableCell>
                            <TableCell>{panel.panel_type || '—'}</TableCell>
                            <TableCell>{panel.qty_needed ?? 1}</TableCell>
                            <TableCell>{custLabel(visit.customer)}</TableCell>
                            <TableCell><FulfillmentBadge type={visit.fulfillment_type} /></TableCell>
                            <TableCell className="whitespace-nowrap">
                              <div className="flex items-center gap-2">
                                <TrackingCell number={tNum} url={tUrl} />
                                {shipped && <ShippedBadge />}
                              </div>
                            </TableCell>
                            <TableCell><StatusBadge status={visit.status} /></TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {loading && <p className="text-sm text-muted-foreground mt-4">Loading…</p>}
      </div>

      {/* Dialog */}
      <VisitFormDialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); setEditingVisit(null); }}
        onSaved={loadData}
        record={editingVisit}
        currentUser={user}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this visit?</AlertDialogTitle>
            <AlertDialogDescription>This also removes its panels. This action cannot be undone.</AlertDialogDescription>
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
