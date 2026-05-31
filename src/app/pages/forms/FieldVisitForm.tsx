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

import { useState, useEffect } from 'react';
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

const baseUrl  = `https://${projectId}.supabase.co/functions/v1/make-server-64775d98`;

// ── Enums ─────────────────────────────────────────────────────────────────────
const VISIT_PURPOSE_OPTS  = ['XFire Installation', 'Training', 'Sales', 'R&D', 'Incident', 'Impromptu', 'Follow Up/Check Up', 'Delivery/Pickup'];
const FIELD_FACILITY_OPTS = ['Field', 'Facility'];

// ── Helpers ───────────────────────────────────────────────────────────────────
function F({ label, required, children, span }: { label: string; required?: boolean; children: React.ReactNode; span?: boolean }) {
  return (
    <div className={span ? 'col-span-2' : ''}>
      <Label className="text-xs font-semibold text-gray-600 mb-1 block">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </Label>
      {children}
    </div>
  );
}

function Section({ title }: { title: string }) {
  return (
    <div className="col-span-2 pt-2 pb-1 border-b border-gray-100">
      <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">{title}</span>
    </div>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  visit?: any;
  currentUser?: any;
}

export default function FieldVisitForm({ open, onClose, onSaved, visit, currentUser }: Props) {
  const editing = !!visit;

  const [customers,     setCustomers]     = useState<any[]>([]);
  const [districts,     setDistricts]     = useState<any[]>([]);
  const [sqmReps,       setSqmReps]       = useState<string[]>([]);
  const [epCompanies,   setEpCompanies]   = useState<string[]>([]);
  const [allPanels,     setAllPanels]     = useState<any[]>([]);
  const [custId,        setCustId]        = useState('');
  const [saving,        setSaving]        = useState(false);
  const [nextVisitId,   setNextVisitId]   = useState<string>('');
  const [locating,      setLocating]      = useState(false);
  const [latLngValue,   setLatLngValue]   = useState('');
  const [xcRep,         setXcRep]         = useState('');

  // Fetch next available Visit ID
  useEffect(() => {
    if (!open || editing) return;
    supabase
      .from('fieldvisits')
      .select('field_visit_id')
      .order('field_visit_id', { ascending: false })
      .limit(20)
      .then(({ data }) => {
        const maxId = (data || []).reduce((max, row) => {
          const n = parseInt(row.field_visit_id);
          return !isNaN(n) && n > max ? n : max;
        }, 0);
        setNextVisitId(String(maxId + 1));
      });
  }, [open, editing]);

  // Pre-fill lat/lng when editing
  useEffect(() => {
    if (visit) setLatLngValue(visit.lat_long || '');
    else setLatLngValue('');
  }, [visit, open]);

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

  useEffect(() => {
    if (visit) setCustId(visit.customer || '');
    else setCustId('');
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
    setSaving(true);
    const fd = new FormData(e.currentTarget);

    const arrival   = fd.get('arrival_date') as string;
    const departure = fd.get('departure_date') as string;

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
      visit_duration:        fd.get('visit_duration')        || null,
      communication_panel:   fd.get('communication_panel')   || null,
      digital_shooting_panel:fd.get('digital_shooting_panel')|| null,
      surface_tester:        fd.get('surface_tester')        || null,
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

  // Panel options grouped by type
  const panelsByType = (type: string) => allPanels.filter(p => p.panel_type === type);

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit Visit ${visit.field_visit_id}` : 'New Field Visit'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-x-6 gap-y-4 mt-2">

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
              className="bg-gray-50 cursor-not-allowed"
              title={editing ? 'Visit ID is locked' : 'Auto-assigned. Cannot be edited.'}
            />
          </F>

          <F label="Visit Purpose" required>
            <select name="visit_purpose" defaultValue={visit?.visit_purpose || ''}
              className="w-full border border-gray-300 rounded-md p-2 text-sm" required>
              <option value="">— Select purpose —</option>
              {VISIT_PURPOSE_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </F>

          <F label="Field or Facility">
            <select name="field_or_facility" defaultValue={visit?.field_or_facility || 'Field'}
              className="w-full border border-gray-300 rounded-md p-2 text-sm">
              {FIELD_FACILITY_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </F>

          {/* ── Dates ── */}
          <Section title="Date & Duration" />

          <F label="Arrival Date / Time" required>
            <Input name="arrival_date" type="datetime-local"
              defaultValue={visit?.arrival_date?.slice(0, 16) || ''} required />
          </F>

          <F label="Departure Date / Time" required>
            <Input name="departure_date" type="datetime-local"
              defaultValue={visit?.departure_date?.slice(0, 16) || ''} required />
          </F>

          <F label="Visit Duration (H:MM:SS)">
            <Input name="visit_duration" defaultValue={visit?.visit_duration || ''}
              placeholder="e.g. 2:30:00  —  auto-calculated if left blank" />
          </F>

          {/* ── Customer ── */}
          <Section title="Customer" />

          <F label="Customer" required>
            <select value={custId} onChange={e => setCustId(e.target.value)}
              className="w-full border border-gray-300 rounded-md p-2 text-sm" required>
              <option value="">— Select customer —</option>
              {customers.map(c => <option key={c.row_id} value={c.row_id}>{c.customer}</option>)}
            </select>
          </F>

          <F label="District" required>
            <select name="customer_district" defaultValue={visit?.customer_district || ''}
              disabled={!custId} className="w-full border border-gray-300 rounded-md p-2 text-sm" required>
              <option value="">— Select district —</option>
              {districts.map(d => <option key={d.row_id} value={d.row_id}>{d.customer_district}</option>)}
            </select>
          </F>

          <F label="Operating Company">
            <select name="operating_company" defaultValue={visit?.operating_company || ''}
              className="w-full border border-gray-300 rounded-md p-2 text-sm">
              <option value="">— Select —</option>
              {epCompanies.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </F>

          {/* ── Personnel ── */}
          <Section title="Personnel" />

          <F label="XC Rep (SQM)" required>
            {/* Auto-pulled from the logged-in user when their name matches an SQM
                rep; otherwise selectable. Editable so the rep can be corrected. */}
            <select name="xc_rep" value={xcRep} onChange={e => setXcRep(e.target.value)}
              className="w-full border border-gray-300 rounded-md p-2 text-sm" required>
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
            <Input name="pad_name" defaultValue={visit?.pad_name || ''} placeholder="e.g. Antelope Canyon 14H" />
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

          {/* ── Panels ── */}
          <Section title="XFire Equipment" />

          <F label="Digital Shooting Panel">
            <select name="digital_shooting_panel" defaultValue={visit?.digital_shooting_panel || ''}
              className="w-full border border-gray-300 rounded-md p-2 text-sm">
              <option value="">— None —</option>
              {panelsByType('Digital Shooting Panel').map(p => (
                <option key={getSerial(p)} value={getSerial(p)}>{getSerial(p)}</option>
              ))}
            </select>
          </F>

          <F label="Communication Panel">
            <select name="communication_panel" defaultValue={visit?.communication_panel || ''}
              className="w-full border border-gray-300 rounded-md p-2 text-sm">
              <option value="">— None —</option>
              {panelsByType('Communication Panel').map(p => (
                <option key={getSerial(p)} value={getSerial(p)}>{getSerial(p)}</option>
              ))}
            </select>
          </F>

          <F label="Surface Tester">
            <select name="surface_tester" defaultValue={visit?.surface_tester || ''}
              className="w-full border border-gray-300 rounded-md p-2 text-sm">
              <option value="">— None —</option>
              {panelsByType('Surface Tester').map(p => (
                <option key={getSerial(p)} value={getSerial(p)}>{getSerial(p)}</option>
              ))}
            </select>
          </F>

          {/* ── Summary ── */}
          <Section title="Summary" />

          <div className="col-span-2">
            <F label="Visit Summary" required>
              <Textarea name="visit_summary" rows={4} required
                defaultValue={visit?.visit_summary || ''}
                placeholder="Brief description of what was accomplished during this visit" />
            </F>
          </div>

          {/* ── Actions ── */}
          <div className="col-span-2 flex justify-end gap-3 pt-4 border-t border-gray-100">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Update Visit' : 'Create Visit'}
            </Button>
          </div>

        </form>
      </DialogContent>
    </Dialog>
  );
}
