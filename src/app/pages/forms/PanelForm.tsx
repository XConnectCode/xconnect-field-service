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

const baseUrl  = `https://${projectId}.supabase.co/functions/v1/make-server-64775d98`;
const headers  = { 'Authorization': `Bearer ${publicAnonKey}`, 'Content-Type': 'application/json' };

// ── Fixed value dropdowns ─────────────────────────────────────────────────────
const PANEL_TYPE_OPTS   = ['Digital Shooting Panel', 'Communication Panel', 'Surface Tester'];
const PANEL_STATUS_OPTS = ['At Facility', 'Leased', 'In Repair', 'Loaned', 'Sold'];
const XC_BASE_OPTS      = ['Denver', 'Midland', 'Williston'];
const YES_NO_OPTS       = ['Yes', 'No'];
const VERIFIED_OPTS     = ['Y', 'N'];
const ACTIVITY_OPTS     = ['Y', 'N'];

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
  panel?: any;
  currentUser?: any;
}

export default function PanelForm({ open, onClose, onSaved, panel, currentUser }: Props) {
  const editing = !!panel;

  const [customers,   setCustomers]   = useState<any[]>([]);
  const [districts,   setDistricts]   = useState<any[]>([]);
  const [epCompanies, setEpCompanies] = useState<string[]>([]);
  const [custId,      setCustId]      = useState('');
  const [saving,      setSaving]      = useState(false);

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
    if (panel) setCustId(panel.customer || '');
    else setCustId('');
  }, [panel, open]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    const fd = new FormData(e.currentTarget);

    const payload: Record<string, any> = {
      'serial#':        fd.get('serial')          || '',
      panel_type:       fd.get('panel_type')       || null,
      plus_panel:       fd.get('plus_panel')       || null,
      panel_status:     fd.get('panel_status')     || null,
      xc_base:          fd.get('xc_base')          || null,
      received_date:    fd.get('received_date')    || null,
      customer:         custId                     || null,
      customer_district:fd.get('customer_district')|| null,
      operating_company:fd.get('operating_company')|| null,
      'unit#':          fd.get('unit')             || null,
      'so#':            fd.get('so')               || null,
      gui_version:      fd.get('gui')              || null,
      shootingfw:       fd.get('shootingfw')       || null,
      wl_controlfw:     fd.get('wl_controlfw')     || null,
      loggingfw:        fd.get('loggingfw')        || null,
      surfacefw:        fd.get('surfacefw')        || null,
      tracking_info:    fd.get('tracking_info')    || null,
      rma:              fd.get('rma')              || null,
      'spare?':         fd.get('spare')            || null,
      verified:         fd.get('verified')         || 'N',
      activity:         fd.get('activity')         || 'N',
      comments:         fd.get('comments')         || null,
      updated_by:       fd.get('updated_by')       || currentUser?.name || null,
      date_updated:     new Date().toLocaleDateString(),
    };

    try {
      const url = editing
        ? `${baseUrl}/panels/${panel.row_id}`
        : `${baseUrl}/panels`;
      const res = await fetch(url, {
        method: editing ? 'PUT' : 'POST',
        headers,
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

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit Panel ${panel?.['serial#']}` : 'Add New XFire Panel'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-x-6 gap-y-4 mt-2">

          {/* ── Identity ── */}
          <Section title="Panel Identity" />

          <F label="Serial #" required>
            <Input name="serial" defaultValue={panel?.['serial#'] || ''} required
              readOnly={editing}
              className={editing ? 'bg-gray-50 cursor-not-allowed' : ''}
              placeholder="e.g. SH230519-2v3" />
          </F>

          <F label="Panel Type" required>
            {editing ? (
              <>
                <div
                  className="w-full border border-gray-300 rounded-md p-2 text-sm bg-gray-50 cursor-not-allowed text-gray-700"
                  title="Panel type is locked after creation"
                >
                  {panel?.panel_type || '—'}
                </div>
                {/* Hidden field so the value is included in form submission */}
                <input type="hidden" name="panel_type" value={panel?.panel_type || ''} />
              </>
            ) : (
              <select name="panel_type" defaultValue={panel?.panel_type || ''}
                className="w-full border border-gray-300 rounded-md p-2 text-sm" required>
                <option value="">— Select type —</option>
                {PANEL_TYPE_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            )}
          </F>

          <F label="Plus Panel?">
            <select name="plus_panel" defaultValue={panel?.plus_panel || ''}
              className="w-full border border-gray-300 rounded-md p-2 text-sm">
              <option value="">— Select —</option>
              {YES_NO_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </F>

          <F label="Unit #">
            <Input name="unit" defaultValue={panel?.['unit#'] || ''} placeholder="e.g. 42" />
          </F>

          <F label="GUI #">
            <Input name="gui" defaultValue={panel?.gui_version || ''} />
          </F>

          <F label="SO #">
            <Input name="so" defaultValue={panel?.['so#'] || ''} />
          </F>

          {/* ── Status & Location ── */}
          <Section title="Status & Location" />

          <F label="Panel Status" required>
            <select name="panel_status" defaultValue={panel?.panel_status || 'At Facility'}
              className="w-full border border-gray-300 rounded-md p-2 text-sm" required>
              <option value="">— Select status —</option>
              {PANEL_STATUS_OPTS.map(o => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </F>

          <F label="XC Base" required>
            <select name="xc_base" defaultValue={panel?.xc_base || ''}
              className="w-full border border-gray-300 rounded-md p-2 text-sm" required>
              <option value="">— Select base —</option>
              {XC_BASE_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </F>

          <F label="Received Date">
            <Input name="received_date" type="date" defaultValue={panel?.received_date || ''} />
          </F>

          {/* ── Assignment ── */}
          <Section title="Customer Assignment" />

          <F label="Customer">
            <select value={custId} onChange={e => setCustId(e.target.value)}
              className="w-full border border-gray-300 rounded-md p-2 text-sm">
              <option value="">— Not assigned —</option>
              {customers.map(c => <option key={c.row_id} value={c.row_id}>{c.customer}</option>)}
            </select>
          </F>

          <F label="District">
            <select name="customer_district" defaultValue={panel?.customer_district || ''}
              disabled={!custId} className="w-full border border-gray-300 rounded-md p-2 text-sm">
              <option value="">— Not assigned —</option>
              {districts.map(d => <option key={d.row_id} value={d.row_id}>{d.customer_district}</option>)}
            </select>
          </F>

          <F label="Operating Company">
            <select name="operating_company" defaultValue={panel?.operating_company || ''}
              className="w-full border border-gray-300 rounded-md p-2 text-sm">
              <option value="">— Select —</option>
              {epCompanies.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </F>

          {/* ── Firmware ── */}
          <Section title="Firmware Versions" />

          <F label="Shooting FW">
            <Input name="shootingfw" defaultValue={panel?.shootingfw || ''} placeholder="e.g. 3.2.1" />
          </F>

          <F label="WL Control FW">
            <Input name="wl_controlfw" defaultValue={panel?.wl_controlfw || ''} />
          </F>

          <F label="Logging FW">
            <Input name="loggingfw" defaultValue={panel?.loggingfw || ''} />
          </F>

          <F label="Surface FW">
            <Input name="surfacefw" defaultValue={panel?.surfacefw || ''} />
          </F>

          {/* ── Tracking ── */}
          <Section title="Tracking & Flags" />

          <F label="Tracking Info">
            <Input name="tracking_info" defaultValue={panel?.tracking_info || ''} placeholder="Shipment tracking number" />
          </F>

          <F label="RMA">
            <Input name="rma" defaultValue={panel?.rma || ''} />
          </F>

          <F label="Spare?">
            <select name="spare" defaultValue={panel?.['spare?'] || ''}
              className="w-full border border-gray-300 rounded-md p-2 text-sm">
              <option value="">— Select —</option>
              {YES_NO_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </F>

          <F label="Verified?">
            <select name="verified" defaultValue={panel?.verified || 'N'}
              className="w-full border border-gray-300 rounded-md p-2 text-sm">
              {VERIFIED_OPTS.map(o => <option key={o} value={o}>{o === 'Y' ? 'Yes (Y)' : 'No (N)'}</option>)}
            </select>
          </F>

          <F label="Activity Flag">
            <select name="activity" defaultValue={panel?.activity || 'N'}
              className="w-full border border-gray-300 rounded-md p-2 text-sm">
              {ACTIVITY_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </F>

          <F label="Updated By">
            <Input name="updated_by" defaultValue={panel?.updated_by || currentUser?.name || ''} />
          </F>

          {/* ── Comments ── */}
          <Section title="Comments" />

          <div className="col-span-2">
            <F label="Comments">
              <Textarea name="comments" rows={3} defaultValue={panel?.comments || ''} />
            </F>
          </div>

          {/* ── Actions ── */}
          <div className="col-span-2 flex justify-end gap-3 pt-4 border-t border-gray-100">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Update Panel' : 'Add Panel'}
            </Button>
          </div>

        </form>
      </DialogContent>
    </Dialog>
  );
}
