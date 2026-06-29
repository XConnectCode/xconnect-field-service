/**
 * PanelForm.tsx
 * Full create/edit dialog for the panels table.
 * Every column is present. Fixed-value columns use dropdowns.
 *
 * Usage:
 *   <PanelForm
 *     open={open}
 *     onClose={() => setOpen(false)}
 *     onSaved={loadData}
 *     panel={editingPanel}   // null = create, object = edit
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
import { projectId, publicAnonKey } from '../../../../utils/supabase/info';
import { XC_PANEL_BASES } from '../../lib/xcLocations';
import { ButtonGroup } from '../../components/ui/button-group';
import { Combobox } from '../../components/ui/combobox';

const baseUrl  = `https://${projectId}.supabase.co/functions/v1/make-server-64775d98`;

// The edge data routes require a real user token after the auth lockdown
// (anon key returns 401). Resolve the live session token at request time and
// fall back to the anon key only if there's no session.
async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token || publicAnonKey;
  return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
}

// ── Fixed value dropdowns ─────────────────────────────────────────────────────
const PANEL_TYPE_OPTS   = ['Surface Tester', 'Master Safe Panel', 'Digital Shooting Panel', 'P1000', 'P2000', 'P2500', 'Toolstring Simulator', 'Pressure Box'];

// ── Conditional field rules (which panel types / statuses each field applies to) ──
const GUI_TYPES        = ['P1000', 'P2000', 'P2500'];
const GUI_STATUSES     = ['Leased', 'Loaned'];
const showPlusPanel    = (type: string) => type === 'P2500';
const showGui          = (type: string, status: string) => GUI_TYPES.includes(type) && GUI_STATUSES.includes(status);
const showSurfaceFw    = (type: string) => type === 'Surface Tester';
const showShootingFw   = (type: string) => type === 'Digital Shooting Panel';
const PANEL_STATUS_OPTS = ['At Facility', 'Leased', 'In Repair', 'Loaned', 'Sold', 'Shipped'];

// ── Customer-assignment field rules (Unit #, SO #, Customer, District,
//    Operating Company, Spare, Activity) ─────────────────────────────────────
//   - At Facility  → fields hidden AND cleared on save (panel is back in-house)
//   - Leased/Loaned/Sold → fields shown AND required
//   - In Repair    → fields shown but optional (could be from XC or customer)
const ASSIGN_REQUIRED_STATUSES = ['Leased', 'Loaned', 'Sold'];
// Canonical "Sold" status string (matches the value in PANEL_STATUS_OPTS).
const SOLD_STATUS = 'Sold';
// Shown for everything except At Facility.
const showAssign       = (status: string) => status !== '' && status !== 'At Facility';
// Required only for Leased / Loaned / Sold.
const assignRequired   = (status: string) => ASSIGN_REQUIRED_STATUSES.includes(status);
// SO # is required only when the panel is Sold; optional for every other status.
const soRequired       = (status: string) => status === SOLD_STATUS;
const XC_BASE_OPTS      = XC_PANEL_BASES; // shared list (Denver kept for Panels inventory)
const YES_NO_OPTS       = ['Yes', 'No'];
const VERIFIED_OPTS     = ['Y', 'N'];
const ACTIVITY_OPTS     = ['Y', 'N'];

// ── Helpers ───────────────────────────────────────────────────────────────────
function F({ label, required, children, span }: { label: string; required?: boolean; children: React.ReactNode; span?: boolean }) {
  return (
    <div className={span ? 'col-span-2' : ''}>
      <Label className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1 block">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </Label>
      {children}
    </div>
  );
}

function Section({ title }: { title: string }) {
  return (
    <div className="col-span-2 pt-2 pb-1 border-b border-gray-100 dark:border-gray-700">
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
   * PanelDetail) can show editing as a full page. The form body, validation,
   * and payload logic are identical in both variants.
   */
  variant?: 'modal' | 'page';
  panel?: any;
  currentUser?: any;
}

export default function PanelForm({ open, onClose, onSaved, variant = 'modal', panel, currentUser }: Props) {
  const editing = !!panel;

  const [customers,   setCustomers]   = useState<any[]>([]);
  const [districts,   setDistricts]   = useState<any[]>([]);
  const [epCompanies, setEpCompanies] = useState<string[]>([]);
  const [custId,      setCustId]      = useState('');
  const [distId,      setDistId]      = useState('');
  const [opCompany,   setOpCompany]   = useState('');
  const [saving,      setSaving]      = useState(false);
  const [panelType,   setPanelType]   = useState('');
  const [panelStatus, setPanelStatus] = useState('At Facility');

  useEffect(() => {
    if (!open) return;
    Promise.all([
      supabase.from('customers').select('row_id,customer').order('customer'),
      supabase.from('ep').select('operating_company').order('operating_company'),
    ]).then(([c, e]) => {
      setCustomers(c.data || []);
      setEpCompanies((e.data || []).map((r: any) => r.operating_company));
    });
  }, [open]);

  useEffect(() => {
    if (!custId) { setDistricts([]); return; }
    supabase.from('districts').select('row_id,customer_district').eq('customer', custId).order('customer_district')
      .then(({ data }) => setDistricts(data || []));
  }, [custId]);

  useEffect(() => {
    if (panel) { setCustId(panel.customer || ''); setDistId(panel.customer_district || ''); setOpCompany(panel.operating_company || ''); }
    else { setCustId(''); setDistId(''); setOpCompany(''); }
  }, [panel, open]);

  useEffect(() => {
    if (!open) return;
    setPanelType(panel?.panel_type || '');
    setPanelStatus(panel?.panel_status || 'At Facility');
  }, [panel, open]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    const fd = new FormData(e.currentTarget);

    const type   = (fd.get('panel_type')   as string) || '';
    const status = (fd.get('panel_status') as string) || '';

    // Customer-assignment fields are conditional on Panel Status:
    //   - Required for Leased / Loaned / Sold
    //   - Optional for In Repair
    //   - Cleared (null) for At Facility, since the panel is back in-house
    const assignVals = {
      customer:          custId,
      customer_district: (fd.get('customer_district') as string) || '',
      operating_company: (fd.get('operating_company') as string) || '',
      unit_number:       (fd.get('unit') as string) || '',
      'so#':             (fd.get('so') as string) || '',
      is_spare:          (fd.get('spare') as string) || '',
      activity:          (fd.get('activity') as string) || '',
    };

    if (assignRequired(status)) {
      const missing: string[] = [];
      if (!assignVals.customer)          missing.push('Customer');
      if (!assignVals.customer_district) missing.push('District');
      if (!assignVals.operating_company) missing.push('Operating Company');
      if (!assignVals.unit_number)       missing.push('Unit #');
      if (soRequired(status) && !assignVals['so#']) missing.push('SO #');
      if (!assignVals.is_spare)          missing.push('Spare');
      if (!assignVals.activity)          missing.push('Activity');
      if (missing.length) {
        toast.error(
          `When Panel Status is "${status}", these fields are required: ${missing.join(', ')}.`,
          { duration: 6000 },
        );
        setSaving(false);
        return;
      }
    }

    // At Facility wipes the customer-assignment fields entirely.
    const clearAssign = status === 'At Facility';

    const payload: Record<string, any> = {
      serial_number:    fd.get('serial')          || '',
      panel_type:       type                       || null,
      plus_panel:       showPlusPanel(type) ? (fd.get('plus_panel') || null) : null,
      panel_status:     status                     || null,
      xc_base:          fd.get('xc_base')          || null,
      received_date:    fd.get('received_date')    || null,
      customer:         clearAssign ? null : (assignVals.customer          || null),
      customer_district:clearAssign ? null : (assignVals.customer_district || null),
      operating_company:clearAssign ? null : (assignVals.operating_company || null),
      unit_number:      clearAssign ? null : (assignVals.unit_number       || null),
      'so#':            clearAssign ? null : (assignVals['so#']            || null),
      gui_version:      showGui(type, status) ? (fd.get('gui') || null) : null,
      shootingfw:       showShootingFw(type) ? (fd.get('shootingfw') || null) : null,
      wl_controlfw:     fd.get('wl_controlfw')     || null,
      loggingfw:        fd.get('loggingfw')        || null,
      surfacefw:        showSurfaceFw(type) ? (fd.get('surfacefw') || null) : null,
      tracking_info:    fd.get('tracking_info')    || null,
      rma:              fd.get('rma')              || null,
      // At Facility unifies the detail-page behavior into the form: a panel
      // back in-house is marked verified and explicitly not-a-spare. Otherwise
      // is_spare is cleared (At Facility had no assignment) and verified keeps
      // its submitted value (default 'N').
      is_spare:         clearAssign ? 'No' : (assignVals.is_spare || null),
      verified:         clearAssign ? 'Y' : (fd.get('verified') || 'N'),
      activity:         clearAssign ? null : (assignVals.activity || null),
      comments:         fd.get('comments')         || null,
      // Ship date: stamp today when marking Shipped (unless one was supplied).
      shipped_date:     status === 'Shipped'
                          ? (fd.get('shipped_date') || new Date().toISOString().slice(0, 10))
                          : (fd.get('shipped_date') || null),
      // Always stamp the user performing this save (create OR edit) — never
      // carry over the prior editor or rely on a typed value.
      updated_by:       currentUser?.name || currentUser?.email || null,
      date_updated:     new Date().toLocaleDateString(),
    };

    try {
      const url = editing
        ? `${baseUrl}/panels/${panel.row_id}`
        : `${baseUrl}/panels`;
      const res = await fetch(url, {
        method: editing ? 'PUT' : 'POST',
        headers: await authHeaders(),
        body: JSON.stringify(payload),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Failed'); }
      toast.success(`Panel ${editing ? 'updated' : 'created'} successfully`);
      onSaved();
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save panel');
    } finally {
      setSaving(false);
    }
  };

  const titleText = editing ? `Edit Panel ${panel?.serial_number}` : 'Add New XFire Panel';

  // The form body is identical in both the modal and full-page shells; only the
  // surrounding chrome differs. The submit button lives inside the <form>, so it
  // works in either shell.
  const formBody = (
        <form id="panel-form" onSubmit={handleSubmit} className="grid grid-cols-2 gap-x-6 gap-y-4 mt-2">

          {/* ── Identity ── */}
          <Section title="Panel Identity" />

          <F label="Serial #" required>
            <Input name="serial" defaultValue={panel?.serial_number || ''} required
              readOnly={editing}
              className={editing ? 'bg-gray-50 cursor-not-allowed' : ''}
              placeholder="e.g. SH230519-2v3" />
          </F>

          <F label="Panel Type" required>
            {editing ? (
              <>
                <div
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-md p-2 text-sm bg-gray-50 dark:bg-gray-800/50 cursor-not-allowed text-gray-700 dark:text-gray-200"
                  title="Panel type is locked after creation"
                >
                  {panel?.panel_type || '—'}
                </div>
                {/* Hidden field so the value is included in form submission */}
                <input type="hidden" name="panel_type" value={panel?.panel_type || ''} />
              </>
            ) : (
              <select name="panel_type" defaultValue={panel?.panel_type || ''}
                onChange={e => setPanelType(e.target.value)}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-md p-2 text-sm" required>
                <option value="">— Select type —</option>
                {PANEL_TYPE_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            )}
          </F>

          {showPlusPanel(panelType) && (
            <F label="Plus Panel?">
              <ButtonGroup name="plus_panel" options={YES_NO_OPTS}
                defaultValue={panel?.plus_panel || ''} />
            </F>
          )}

          {showAssign(panelStatus) && (
            <F label="Unit #" required={assignRequired(panelStatus)}>
              <Input name="unit" defaultValue={panel?.unit_number || ''} placeholder="e.g. 42"
                required={assignRequired(panelStatus)} />
            </F>
          )}

          {showGui(panelType, panelStatus) && (
            <F label="GUI #">
              <Input name="gui" defaultValue={panel?.gui_version || ''} />
            </F>
          )}

          {showAssign(panelStatus) && (
            <F label="SO #" required={soRequired(panelStatus)}>
              <Input name="so" defaultValue={panel?.['so#'] || ''}
                required={soRequired(panelStatus)} />
            </F>
          )}

          {/* ── Status & Location ── */}
          <Section title="Status & Location" />

          <F label="Panel Status" required>
            <ButtonGroup name="panel_status" required
              options={PANEL_STATUS_OPTS}
              value={panelStatus}
              onChange={v => setPanelStatus(v)} />
          </F>

          <F label="XC Base" required>
            <select name="xc_base" defaultValue={panel?.xc_base || ''}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-md p-2 text-sm" required>
              <option value="">— Select base —</option>
              {XC_BASE_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </F>

          <F label="Received Date">
            {/* Received date is a historical fact: auto-populated to today when a
                panel is first added, and locked thereafter (read-only on both
                create and edit). readOnly inputs still submit their value via
                FormData, so the auto-filled date is saved on create. */}
            <Input
              name="received_date"
              type="date"
              defaultValue={panel?.received_date || (editing ? '' : new Date().toISOString().slice(0, 10))}
              readOnly
              className="bg-gray-50 dark:bg-gray-800/50 cursor-not-allowed"
              title={editing ? 'Received date is locked after creation' : 'Auto-set to today. Cannot be edited.'}
            />
          </F>

          {/* ── Assignment (only when Leased / Loaned / Sold / In Repair) ── */}
          {showAssign(panelStatus) && (
            <>
              <Section title="Customer Assignment" />

              <F label="Customer" required={assignRequired(panelStatus)}>
                <Combobox
                  value={custId}
                  onValueChange={(v) => { setCustId(v); setDistId(''); }}
                  options={customers.map(c => ({ value: c.row_id, label: c.customer }))}
                  placeholder="— Not assigned —"
                  searchPlaceholder="Search customers…"
                  emptyText="No customers found."
                  allowClear
                />
              </F>

              <F label="District" required={assignRequired(panelStatus)}>
                <input type="hidden" name="customer_district" value={distId} />
                <Combobox
                  value={distId}
                  onValueChange={setDistId}
                  disabled={!custId}
                  options={districts.map(d => ({ value: d.row_id, label: d.customer_district }))}
                  placeholder="— Not assigned —"
                  searchPlaceholder="Search districts…"
                  emptyText="No districts found."
                  allowClear
                />
              </F>

              <F label="Operating Company" required={assignRequired(panelStatus)}>
                <input type="hidden" name="operating_company" value={opCompany} />
                <Combobox
                  value={opCompany}
                  onValueChange={setOpCompany}
                  options={epCompanies.map(o => ({ value: o, label: o }))}
                  placeholder="— Select —"
                  searchPlaceholder="Search operating companies…"
                  emptyText="No operating companies found."
                  allowClear
                />
              </F>
            </>
          )}

          {/* ── Firmware ── */}
          <Section title="Firmware Versions" />

          {showShootingFw(panelType) && (
            <F label="Shooting FW">
              <Input name="shootingfw" defaultValue={panel?.shootingfw || ''} placeholder="e.g. 3.2.1" />
            </F>
          )}

          <F label="WL Control FW">
            <Input name="wl_controlfw" defaultValue={panel?.wl_controlfw || ''} />
          </F>

          <F label="Logging FW">
            <Input name="loggingfw" defaultValue={panel?.loggingfw || ''} />
          </F>

          {showSurfaceFw(panelType) && (
            <F label="Surface FW">
              <Input name="surfacefw" defaultValue={panel?.surfacefw || ''} />
            </F>
          )}

          {/* ── Tracking ── */}
          <Section title="Tracking & Flags" />

          <F label="Tracking Info">
            <Input name="tracking_info" defaultValue={panel?.tracking_info || ''} placeholder="Shipment tracking number" />
          </F>

          <F label="RMA">
            <Input name="rma" defaultValue={panel?.rma || ''} />
          </F>

          {showAssign(panelStatus) && (
            <F label="Spare?" required={assignRequired(panelStatus)}>
              <ButtonGroup name="spare" options={YES_NO_OPTS}
                required={assignRequired(panelStatus)}
                defaultValue={panel?.is_spare || ''} />
            </F>
          )}

          <F label="Verified?">
            <ButtonGroup name="verified"
              options={VERIFIED_OPTS.map(o => ({ value: o, label: o === 'Y' ? 'Yes (Y)' : 'No (N)' }))}
              defaultValue={panel?.verified || 'N'} />
          </F>

          {showAssign(panelStatus) && (
            <F label="Activity Flag" required={assignRequired(panelStatus)}>
              <ButtonGroup name="activity" options={ACTIVITY_OPTS}
                required={assignRequired(panelStatus)}
                defaultValue={panel?.activity || ''} />
            </F>
          )}

          <F label="Updated By">
            {/* Auto-pulled from the logged-in user and locked — the person saving
                the form is the one making the update, so this is never typed by
                hand. readOnly inputs still submit, so the value is saved. The
                handleSubmit fallback also defaults updated_by to currentUser. */}
            <Input
              name="updated_by"
              value={currentUser?.name || currentUser?.email || ''}
              readOnly
              className="bg-gray-50 dark:bg-gray-800/50 cursor-not-allowed"
              title="Auto-set to the current user. Cannot be edited."
            />
          </F>

          {/* ── Comments ── */}
          <Section title="Comments" />

          <div className="col-span-2">
            <F label="Comments">
              <Textarea name="comments" rows={3} defaultValue={panel?.comments || ''} />
            </F>
          </div>

          {/* ── Actions ── */}
          <div className="col-span-2 flex justify-end gap-3 pt-4 border-t border-gray-100 dark:border-gray-700">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Update Panel' : 'Add Panel'}
            </Button>
          </div>

        </form>
  );

  // ── Full-page shell (variant='page') ──
  // Renders the same header/body inline, sized to fill the routed page, so panel
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
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{titleText}</DialogTitle>
        </DialogHeader>
        {formBody}
      </DialogContent>
    </Dialog>
  );
}
