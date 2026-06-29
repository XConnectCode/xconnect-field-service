/**
 * FieldVisitForm.tsx
 * Full create/edit dialog for the fieldvisits table.
 * Every column is present. Enum columns use dropdowns.
 * Panel serial# columns load from panels table.
 *
 * Usage:
 *   <FieldVisitForm
 *     open={open}
 *     onClose={() => setOpen(false)}
 *     onSaved={loadData}
 *     visit={editingVisit}   // null = create, object = edit
 *     currentUser={user}
 *   />
 */

import { useState, useEffect, useLayoutEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { toast } from 'sonner';
import { getSerial } from '../../lib/serialUtils';
import { projectId } from '../../../../utils/supabase/info';
import { getAuthHeaders } from '../../lib/authHeaders';
import { ButtonGroup } from '../../components/ui/button-group';
import { Combobox } from '../../components/ui/combobox';
import { computeVisitDuration } from '../../lib/visitDuration';
import PanelsSeenPicker from '../../components/PanelsSeenPicker';

const baseUrl  = `https://${projectId}.supabase.co/functions/v1/make-server-64775d98`;

// ── Enums ─────────────────────────────────────────────────────────────────────
const VISIT_PURPOSE_OPTS  = ['XFire Installation', 'Training', 'Sales', 'R&D', 'Incident', 'Impromptu', 'Follow Up/Check Up', 'Delivery/Pickup'];
const FIELD_FACILITY_OPTS = ['Field', 'Facility'];

// ── Helpers ───────────────────────────────────────────────────────────────────
function F({ label, required, children, span }: { label: string; required?: boolean; children: React.ReactNode; span?: boolean }) {
  return (
    <div className={span ? 'col-span-1 md:col-span-2' : ''}>
      <Label className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1 block">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </Label>
      {children}
    </div>
  );
}

function Section({ title }: { title: string }) {
  return (
    <div className="col-span-1 md:col-span-2 pt-2 pb-1 border-b border-gray-100 dark:border-gray-700">
      <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">{title}</span>
    </div>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  /**
   * Render shell. 'modal' (default) wraps the form in a Radix Dialog. 'page'
   * renders the exact same header/form/footer inline so a parent route (e.g.
   * FieldVisitDetail) can show editing as a full page. The form body,
   * validation, and payload logic are identical in both variants.
   */
  variant?: 'modal' | 'page';
  visit?: any;
  currentUser?: any;
  /**
   * E2 "Copy / Start New": seed a brand-new visit from an existing one. Unlike
   * `visit`, this never switches the form to edit mode — the record is created
   * fresh (new auto Visit ID, fresh Open). Only the durable location/customer
   * context is carried; dates, times, duration, reps, summary, status,
   * signatures and linked checklists/inspections are intentionally NOT seeded.
   */
  prefill?: {
    customer?: string | null;            // customers.row_id
    customer_district?: string | null;   // districts.row_id
    operating_company?: string | null;
    pad_name?: string | null;
    lat_long?: string | null;
  } | null;
}

export default function FieldVisitForm({ open, onClose, onSaved, variant = 'modal', visit, currentUser, prefill }: Props) {
  const editing = !!visit;

  const [customers,     setCustomers]     = useState<any[]>([]);
  const [districts,     setDistricts]     = useState<any[]>([]);
  const [sqmReps,       setSqmReps]       = useState<string[]>([]);
  const [epCompanies,   setEpCompanies]   = useState<string[]>([]);
  const [allPanels,     setAllPanels]     = useState<any[]>([]);
  const [custId,        setCustId]        = useState('');
  const [distId,        setDistId]        = useState('');
  const [opCompany,     setOpCompany]     = useState('');
  const [saving,        setSaving]        = useState(false);
  const [nextVisitId,   setNextVisitId]   = useState<string>('');
  const [locating,      setLocating]      = useState(false);
  const [latLngValue,   setLatLngValue]   = useState('');
  const [xcRep,         setXcRep]         = useState('');
  // Arrival / departure are controlled so Visit Duration can be live-computed
  // (arrival → departure). Duration is a derived, read-only display — never an
  // editable field and never submitted as a manual value.
  const [arrivalDate,   setArrivalDate]   = useState('');
  const [departureDate, setDepartureDate] = useState('');
  // Multi-select of panel serials seen on this visit. Replaces the 3 legacy
  // single dropdowns (digital_shooting_panel / communication_panel /
  // surface_tester). Marking a panel here stamps it verified='Y' + last-seen
  // on save (handled server-side).
  const [panelsSeen,    setPanelsSeen]    = useState<string[]>([]);

  // Fetch next available Visit ID — scan ALL field_visit_ids and find the true
  // numeric max. We can't .order() because Postgres sorts field_visit_id as
  // text (e.g. "999" > "1500"). We MUST paginate: Supabase caps a single
  // .select() at 1000 rows, so an unbounded select silently misses higher IDs
  // once the table grows past 1000 (the bug this fixes). Mirrors IncidentForm.
  useEffect(() => {
    if (!open || editing) return;
    let cancelled = false;
    (async () => {
      const PAGE = 1000;
      let from = 0;
      let maxId = 0;
      // Loop pages until a short page (fewer than PAGE rows) signals the end.
      while (true) {
        const { data, error } = await supabase
          .from('fieldvisits')
          .select('field_visit_id')
          .range(from, from + PAGE - 1);
        if (error || !data) break;
        for (const row of data as any[]) {
          const n = parseInt(row.field_visit_id, 10);
          if (!isNaN(n) && n > maxId) maxId = n;
        }
        if (data.length < PAGE) break;
        from += PAGE;
      }
      if (!cancelled) setNextVisitId(String(maxId + 1));
    })();
    return () => { cancelled = true; };
  }, [open, editing]);

  // Pre-fill lat/lng when editing, or from a Copy/Start New prefill on create.
  useEffect(() => {
    if (visit) setLatLngValue(visit.lat_long || '');
    else setLatLngValue(prefill?.lat_long || '');
  }, [visit, open, prefill]);

  // Seed arrival / departure (datetime-local wants YYYY-MM-DDTHH:MM).
  useEffect(() => {
    if (!open) { setArrivalDate(''); setDepartureDate(''); return; }
    setArrivalDate(visit?.arrival_date?.slice(0, 16) || '');
    setDepartureDate(visit?.departure_date?.slice(0, 16) || '');
  }, [visit, open]);

  // Live-computed, read-only visit duration (HH:MM:SS) from the two timestamps.
  const computedDuration = computeVisitDuration(arrivalDate, departureDate);

  useEffect(() => {
    if (!open) return;
    Promise.all([
      supabase.from('customers').select('row_id,customer').order('customer'),
      supabase.from('sqm').select('sq_manager').order('sq_manager'),
      supabase.from('ep').select('operating_company').order('operating_company'),
      supabase.from('panels').select('serial_number,panel_type').order('serial_number'),
    ]).then(([c, s, e, p]) => {
      setCustomers(c.data || []);
      setSqmReps((s.data || []).map((r: any) => r.sq_manager).filter((r: string) => r !== 'Pre-Tracking'));
      setEpCompanies((e.data || []).map((r: any) => r.operating_company));
      setAllPanels(p.data || []);
    });
  }, [open]);

  useEffect(() => {
    if (!custId) { setDistricts([]); return; }
    supabase.from('districts').select('row_id,customer_district').eq('customer', custId).order('customer_district')
      .then(({ data }) => setDistricts(data || []));
  }, [custId]);

  // Seed customer / district / operating company synchronously (before paint)
  // when the dialog opens. useLayoutEffect — not useEffect — so the prefilled
  // values are in state before the first paint, eliminating the visible lag
  // where Operating Company flashed blank then populated on copy/new.
  useLayoutEffect(() => {
    if (!open) return;
    if (visit) {
      setCustId(visit.customer || '');
      setDistId(visit.customer_district || '');
      setOpCompany(visit.operating_company || '');
    } else {
      setCustId(prefill?.customer || '');
      setDistId(prefill?.customer_district || '');
      setOpCompany(prefill?.operating_company || '');
    }
  }, [visit, open, prefill]);

  // Seed the Panels Seen multi-select. Prefer the new panels_seen array; for
  // legacy visits saved before this field existed, fall back to the 3 old
  // single dropdown columns so nothing is lost on edit.
  useEffect(() => {
    if (!open) { setPanelsSeen([]); return; }
    if (visit) {
      const arr: string[] = Array.isArray(visit.panels_seen) ? visit.panels_seen.filter(Boolean) : [];
      if (arr.length > 0) {
        setPanelsSeen(Array.from(new Set(arr.map((s: any) => String(s)))));
      } else {
        const legacy = [visit.digital_shooting_panel, visit.communication_panel, visit.surface_tester]
          .map((s: any) => (s == null ? '' : String(s).trim()))
          .filter((s: string) => s !== '');
        setPanelsSeen(Array.from(new Set(legacy)));
      }
    } else {
      setPanelsSeen([]);
    }
  }, [visit, open]);

  // XC Rep: on edit keep the stored rep; on create auto-pull the logged-in
  // user. The field is a constrained dropdown of SQM reps, so only pre-select
  // the user's name when it actually matches a valid option; otherwise leave it
  // for the user to pick. Runs once reps load / dialog opens.
  useEffect(() => {
    if (!open) return;
    if (editing) { setXcRep(visit?.xc_rep || ''); return; }
    const me = currentUser?.name || '';
    setXcRep(me && sqmReps.includes(me) ? me : '');
  }, [open, editing, visit, currentUser, sqmReps]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);

    const arrival   = fd.get('arrival_date') as string;
    const departure = fd.get('departure_date') as string;

    // Date sanity checks (ported from FieldVisitDetail for full parity): the
    // departure can't be in the future, and can't precede the arrival. Toast
    // and abort before the network call so the form stays open for correction.
    if (departure) {
      const dep = new Date(departure);
      if (!Number.isNaN(dep.getTime()) && dep.getTime() > Date.now()) {
        toast.error('Departure date cannot be in the future.');
        return;
      }
    }
    if (arrival && departure) {
      const arr = new Date(arrival);
      const dep = new Date(departure);
      if (!Number.isNaN(arr.getTime()) && !Number.isNaN(dep.getTime()) && dep < arr) {
        toast.error('Departure date cannot be before the arrival date.');
        return;
      }
    }

    // Derive the 3 legacy single-value columns from the multi-select so older
    // reads still work: pick the first selected panel of each legacy type.
    const seenList = Array.from(new Set(panelsSeen.map(s => String(s).trim()).filter(Boolean)));

    // A Field visit must record at least one panel seen (Facility visits may not
    // involve panels). Block submit early so the validation fires before the
    // network call and the form stays open for correction.
    const fieldOrFacility = (fd.get('field_or_facility') as string) || 'Field';
    if (fieldOrFacility === 'Field' && seenList.length === 0) {
      toast.error('Select at least one panel seen for a Field visit.');
      return;
    }

    setSaving(true);
    const typeOf = (serial: string) => {
      const p = allPanels.find(pp => getSerial(pp) === serial);
      return p?.panel_type || '';
    };
    const firstOfType = (type: string) => seenList.find(s => typeOf(s) === type) || null;

    const payload: Record<string, any> = {
      field_visit_id:        fd.get('field_visit_id')        || '',
      arrival_date:          arrival                         || null,
      departure_date:        departure                       || null,
      visit_purpose:         fd.get('visit_purpose')         || null,
      field_or_facility:     fd.get('field_or_facility')     || 'Field',
      customer:              custId                          || null,
      customer_district:     fd.get('customer_district')     || null,
      xc_rep:                fd.get('xc_rep')                || null,
      customer_rep:          fd.get('customer_rep')          || null,
      operating_company:     fd.get('operating_company')     || null,
      pad_name:              fd.get('pad_name')              || null,
      lat_long:              fd.get('lat_long')              || null,
      // visit_duration is derived from arrival → departure and is not persisted
      // from the form (read-only computed display).
      panels_seen:           seenList,
      // Legacy single-value mirrors (derived from panels_seen for back-compat).
      communication_panel:   firstOfType('Communication Panel'),
      digital_shooting_panel:firstOfType('Digital Shooting Panel'),
      surface_tester:        firstOfType('Surface Tester'),
      visit_summary:         fd.get('visit_summary')         || null,
    };

    try {
      const url = editing
        ? `${baseUrl}/fieldvisits/${visit.row_id}`
        : `${baseUrl}/fieldvisits`;
      const res = await fetch(url, {
        method: editing ? 'PUT' : 'POST',
        // Forward the live session token (edge routes require a real user).
        headers: await getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Failed'); }
      toast.success(`Field visit ${editing ? 'updated' : 'created'} successfully`);
      onSaved();
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save field visit');
    } finally {
      setSaving(false);
    }
  };

  const titleText = editing ? `Edit Visit ${visit.field_visit_id}` : 'New Field Visit';

  // The form body is identical in both the modal and full-page shells; only the
  // surrounding chrome differs. The submit button lives inside the <form>, so it
  // works in either shell.
  const formBody = (
        <form id="fieldvisit-form" onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 mt-2">

          {/* ── Core ── */}
          <Section title="Visit Info" />

          <F label="Visit ID" required>
            {/* Auto-populated: next sequential ID on create, stored ID on edit.
                Locked read-only so it can't be hand-edited. readOnly inputs
                still submit their value via FormData. */}
            <Input
              name="field_visit_id"
              value={editing ? (visit?.field_visit_id || '') : nextVisitId}
              readOnly
              required
              className="bg-gray-50 dark:bg-gray-800/50 cursor-not-allowed"
              title={editing ? 'Visit ID is locked' : 'Auto-assigned. Cannot be edited.'}
            />
          </F>

          <F label="Visit Purpose" required>
            <select name="visit_purpose" defaultValue={visit?.visit_purpose || ''}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-md p-2 text-sm" required>
              <option value="">— Select purpose —</option>
              {VISIT_PURPOSE_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </F>

          <F label="Field or Facility">
            <ButtonGroup name="field_or_facility"
              options={FIELD_FACILITY_OPTS}
              defaultValue={visit?.field_or_facility || 'Field'} />
          </F>

          {/* ── Dates ── */}
          <Section title="Date & Duration" />

          <F label="Arrival Date / Time" required>
            <Input name="arrival_date" type="datetime-local"
              value={arrivalDate} onChange={e => setArrivalDate(e.target.value)} required />
          </F>

          <F label="Departure Date / Time" required>
            <Input name="departure_date" type="datetime-local"
              value={departureDate} onChange={e => setDepartureDate(e.target.value)} required />
          </F>

          {/* Visit Duration is derived from arrival → departure: read-only,
              auto-computed, and never submitted as a manual value. */}
          <F label="Visit Duration (auto-calculated)">
            <div className="w-full border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 rounded-md p-2 text-sm text-gray-700 dark:text-gray-200">
              {computedDuration || '—'}
            </div>
          </F>

          {/* ── Customer ── */}
          <Section title="Customer" />

          <F label="Customer" required>
            <Combobox
              value={custId}
              onValueChange={(v) => { setCustId(v); setDistId(''); }}
              options={customers.map(c => ({ value: c.row_id, label: c.customer }))}
              placeholder="— Select customer —"
              searchPlaceholder="Search customers…"
              emptyText="No customers found."
            />
          </F>

          <F label="District" required>
            <input type="hidden" name="customer_district" value={distId} />
            <Combobox
              value={distId}
              onValueChange={setDistId}
              disabled={!custId}
              options={districts.map(d => ({ value: d.row_id, label: d.customer_district }))}
              placeholder="— Select district —"
              searchPlaceholder="Search districts…"
              emptyText="No districts found."
            />
          </F>

          <F label="Operating Company">
            <input type="hidden" name="operating_company" value={opCompany} />
            <Combobox
              value={opCompany}
              onValueChange={setOpCompany}
              // Ensure the seeded value renders its label immediately, even
              // before the EP list finishes loading (Combobox shows the
              // placeholder unless the value matches an option).
              options={(opCompany && !epCompanies.includes(opCompany)
                ? [opCompany, ...epCompanies]
                : epCompanies
              ).map(o => ({ value: o, label: o }))}
              placeholder="— Select —"
              searchPlaceholder="Search operating companies…"
              emptyText="No operating companies found."
              allowClear
            />
          </F>

          {/* ── Personnel ── */}
          <Section title="Personnel" />

          <F label="XC Rep (SQM)" required>
            {/* Auto-pulled from the logged-in user when their name matches an SQM
                rep; otherwise selectable. Editable so the rep can be corrected. */}
            <select name="xc_rep" value={xcRep} onChange={e => setXcRep(e.target.value)}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-md p-2 text-sm" required>
              <option value="">— Select —</option>
              {sqmReps.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </F>

          <F label="Customer Rep">
            <Input name="customer_rep" defaultValue={visit?.customer_rep || ''} />
          </F>

          {/* ── Location ── */}
          <Section title="Location" />

          <F label="Pad Name">
            <Input name="pad_name" defaultValue={visit?.pad_name || prefill?.pad_name || ''} placeholder="e.g. Antelope Canyon 14H" />
          </F>

          <F label="Lat / Long">
            <div style={{ display: 'flex', gap: 8 }}>
              <Input
                name="lat_long"
                value={latLngValue}
                onChange={e => setLatLngValue(e.target.value)}
                placeholder="e.g. 48.626170, -103.496970"
                style={{ flex: 1 }}
              />
              <button
                type="button"
                disabled={locating}
                onClick={() => {
                  if (!('geolocation' in navigator)) {
                    alert('Geolocation not supported by your browser.');
                    return;
                  }
                  setLocating(true);
                  navigator.geolocation.getCurrentPosition(
                    (pos) => {
                      const lat = pos.coords.latitude.toFixed(6);
                      const lng = pos.coords.longitude.toFixed(6);
                      setLatLngValue(`${lat}, ${lng}`);
                      setLocating(false);
                    },
                    (err) => {
                      alert('Could not get location: ' + err.message);
                      setLocating(false);
                    },
                    { enableHighAccuracy: true, timeout: 10000 }
                  );
                }}
                style={{
                  padding: '0 12px', borderRadius: 6,
                  border: '1px solid #e2e8f0',
                  background: locating ? '#f1f5f9' : '#fff',
                  cursor: locating ? 'wait' : 'pointer',
                  fontSize: 18, color: '#475569',
                }}
                title="Use my current location"
              >
                {locating ? '⏳' : '📍'}
              </button>
            </div>
          </F>

          {/* ── Panels Seen ── */}
          <Section title="Panels Seen" />

          <div className="col-span-1 md:col-span-2">
            <PanelsSeenPicker panels={allPanels} value={panelsSeen} onChange={setPanelsSeen} />
          </div>

          {/* ── Summary ── */}
          <Section title="Summary" />

          <div className="col-span-1 md:col-span-2">
            <F label="Visit Summary" required>
              <Textarea name="visit_summary" rows={4} required
                defaultValue={visit?.visit_summary || ''}
                placeholder="Brief description of what was accomplished during this visit" />
            </F>
          </div>

          {/* ── Actions ── */}
          <div className="col-span-1 md:col-span-2 flex justify-end gap-3 pt-4 border-t border-gray-100 dark:border-gray-700">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Update Visit' : 'Create Visit'}
            </Button>
          </div>

        </form>
  );

  // ── Full-page shell (variant='page') ──
  // Renders the same header/body inline, sized to fill the routed page, so visit
  // editing looks like a full page instead of a modal. No Radix Dialog overlay.
  if (variant === 'page') {
    return (
      <div className="flex flex-col h-[calc(100vh-4rem)] overflow-y-auto bg-white dark:bg-gray-900">
        <div className="px-4 md:px-6 pt-5 pb-3 border-b shrink-0">
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{titleText}</h1>
        </div>
        <div className="px-4 md:px-6 py-4">{formBody}</div>
      </div>
    );
  }

  // ── Modal shell (default) ──
  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-4xl w-[95vw] md:w-full max-h-[90vh] overflow-y-auto p-4 md:p-6">
        <DialogHeader>
          <DialogTitle>{titleText}</DialogTitle>
        </DialogHeader>
        {formBody}
      </DialogContent>
    </Dialog>
  );
}
