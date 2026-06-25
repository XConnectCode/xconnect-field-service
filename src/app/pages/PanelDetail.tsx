import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useAuth } from '../lib/auth-context';
import { detailApi, panelApi } from '../lib/api';
import { supabase } from '../lib/supabase';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Combobox } from '../components/ui/combobox';
import { Textarea } from '../components/ui/textarea';
import { ArrowLeft, Pencil, Save, X, Loader2, History, PackageCheck, PackageX, FileDown, Eye } from 'lucide-react';
import { toast } from 'sonner';
import ImageUpload from '../components/ImageUpload';
import { projectId, publicAnonKey } from '../../../utils/supabase/info';
import { XC_PANEL_BASES } from '../lib/xcLocations';
import { generateRepairFailureReportPDF } from '../lib/generateRepairFailureReportPDF';

// ── Option arrays ──────────────────────────────────────────────────────────────
const PANEL_TYPE_OPTS = [
  'Surface Tester',
  'Master Safe Panel',
  'Digital Shooting Panel',
  'P1000',
  'P2000',
  'P2500',
  'Toolstring Simulator',
  'Pressure Box',
];

const PANEL_STATUS_OPTS = [
  'At Facility',
  'Leased',
  'In Repair',
  'Loaned',
  'Sold',
  'Shipped',
];

// Statuses where a panel is out with a customer / off-site and can be returned
// to a XC facility. 'Sold' is excluded (goes to a customer permanently) and
// 'At Facility' is excluded (already home). Returning auto-sets 'At Facility'.
const RETURNABLE_STATUSES = ['Leased', 'Loaned', 'In Repair'];
const RETURNED_STATUS = 'At Facility';

const XC_BASE_OPTS = XC_PANEL_BASES; // shared list (Denver kept for Panels inventory)
const YES_NO_OPTS = ['Yes', 'No'];
const YN_OPTS = ['Y', 'N'];

// Conditional field rules (identical to PanelForm)
const GUI_TYPES    = ['P1000', 'P2000', 'P2500'];
const GUI_STATUSES = ['Leased', 'Loaned'];
const showPlusPanel  = (type: string) => type === 'P2500';
const showGui        = (type: string, status: string) => GUI_TYPES.includes(type) && GUI_STATUSES.includes(status);
const showSurfaceFw  = (type: string) => type === 'Surface Tester';
const showShootingFw = (type: string) => type === 'Digital Shooting Panel';

// ── Field helper ───────────────────────────────────────────────────────────────
interface FieldProps {
  label: string;
  value: React.ReactNode;
  editing?: boolean;
  children?: React.ReactNode; // edit control
}

function Field({ label, value, editing = false, children }: FieldProps) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      {editing && children ? (
        children
      ) : (
        <p className="text-sm text-gray-900 dark:text-gray-100">{value || '—'}</p>
      )}
    </div>
  );
}

// ── Status badge color ─────────────────────────────────────────────────────────
function getStatusColor(status: string) {
  switch (status?.toLowerCase()) {
    case 'at facility': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300';
    case 'leased': return 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300';
    case 'in repair': return 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300';
    case 'loaned': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300';
    case 'sold': return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
    case 'shipped': return 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300';
    // legacy values kept for backwards compat
    case 'installed': return 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300';
    case 'in stock': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300';
    case 'in transit': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300';
    case 'maintenance': return 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300';
    default: return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
  }
}

// ── Select helper ──────────────────────────────────────────────────────────────
function Sel({
  value,
  onChange,
  opts,
  placeholder = '',
}: {
  value: string;
  onChange: (v: string) => void;
  opts: string[];
  placeholder?: string;
}) {
  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      className="w-full border border-gray-300 dark:border-gray-600 rounded-md p-2 text-sm"
    >
      {placeholder && <option value="">{placeholder}</option>}
      {opts.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function PanelDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { accessToken, user } = useAuth();

  const [panel, setPanel] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setFormState] = useState<any>({});

  // Mark-Returned hero action state (optional overrides before confirming).
  const [returning, setReturning] = useState(false);
  const [returnDateInput, setReturnDateInput] = useState('');
  const [returnNotesInput, setReturnNotesInput] = useState('');
  const [seenSaving, setSeenSaving] = useState(false);

  // Return-to-Manufacturer (RMA) action state + controlled form inputs.
  const [returningMfr, setReturningMfr] = useState(false);
  const [mfrNameInput, setMfrNameInput] = useState('AWS');
  const [mfrRmaInput, setMfrRmaInput] = useState('');
  const [mfrShipDateInput, setMfrShipDateInput] = useState('');
  const [mfrTrackingInput, setMfrTrackingInput] = useState('');
  const [failureDescInput, setFailureDescInput] = useState('');
  const [failureDateInput, setFailureDateInput] = useState('');
  const [failureReportedByInput, setFailureReportedByInput] = useState('');

  // Reference data (same sources as PanelForm) for FK selects.
  const [customers,   setCustomers]   = useState<any[]>([]);
  const [districts,   setDistricts]   = useState<any[]>([]);
  const [epCompanies, setEpCompanies] = useState<string[]>([]);

  // Change history (field-level diffs from panel_change_log).
  const [history, setHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  // Global id -> name maps so FK changes (customer/district) render readable
  // values, including historical ones no longer tied to the current customer.
  const [nameMap, setNameMap] = useState<Record<string, string>>({});

  useEffect(() => {
    loadPanel();
  }, [id]);

  // Load customers + operating companies once we're authenticated (mirrors PanelForm).
  useEffect(() => {
    if (!accessToken) return;
    Promise.all([
      supabase.from('customers').select('row_id,customer').order('customer'),
      supabase.from('ep').select('operating_company').order('operating_company'),
    ]).then(([c, e]) => {
      setCustomers(c.data || []);
      setEpCompanies((e.data || []).map((r: any) => r.operating_company).filter(Boolean));
    });
  }, [accessToken]);

  // Cascade districts off the currently-selected customer (form.customer while
  // editing, else the panel's stored customer). Mirrors PanelForm.
  useEffect(() => {
    const custId = editing ? form.customer : panel?.customer;
    if (!custId) { setDistricts([]); return; }
    supabase.from('districts').select('row_id,customer_district').eq('customer', custId).order('customer_district')
      .then(({ data }) => setDistricts(data || []));
  }, [editing, form.customer, panel?.customer]);

  const loadPanel = async () => {
    if (!id || !accessToken) {
      setLoading(false);
      return;
    }
    try {
      const data = await detailApi.getPanel(id, accessToken);
      setPanel(data);
    } catch (error: any) {
      console.error('Error loading panel:', error);
      toast.error('Failed to load panel details');
    } finally {
      setLoading(false);
    }
  };

  // Build a global id -> name map for customers + districts so FK changes in
  // the change history (which store raw ids) render as readable names.
  useEffect(() => {
    if (!accessToken) return;
    Promise.all([
      supabase.from('customers').select('row_id,customer'),
      supabase.from('districts').select('row_id,customer_district'),
    ]).then(([c, d]) => {
      const m: Record<string, string> = {};
      (c.data || []).forEach((r: any) => { if (r.row_id) m[r.row_id] = r.customer; });
      (d.data || []).forEach((r: any) => { if (r.row_id) m[r.row_id] = r.customer_district; });
      setNameMap(m);
    });
  }, [accessToken]);

  // Load the change history for this panel (by row_id, falling back to serial
  // so edits made before a row_id existed still surface).
  const loadHistory = async () => {
    if (!panel?.row_id || !accessToken) return;
    setHistoryLoading(true);
    try {
      const { data, error } = await supabase
        .from('panel_change_log')
        .select('id, entry_type, field, field_label, old_value, new_value, changed_by, changed_at')
        .or(`panel_row_id.eq.${panel.row_id},serial_number.eq.${panel.serial_number}`)
        .order('changed_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      setHistory(data || []);
    } catch (err) {
      console.error('Error loading panel history:', err);
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    loadHistory();
    // Reload after a save so the new diffs show without a full page refresh.
  }, [panel?.row_id, accessToken]);

  // FK fields whose stored value is an id we should resolve to a name.
  const FK_FIELDS = new Set(['customer', 'customer_district']);
  const displayValue = (field: string, value: string | null): string => {
    if (value === null || value === '') return '—';
    if (FK_FIELDS.has(field)) return nameMap[value] || value;
    return value;
  };
  const fmtWhen = (iso: string): string => {
    // Legacy snapshots with no parseable date were stamped with a sentinel of
    // 2000-01-01; show those as undated rather than a misleading timestamp.
    if (iso && iso.startsWith('2000-01-01')) return 'Legacy (date unknown)';
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  };

  const setField = (name: string, value: any) => {
    setFormState((prev: any) => ({ ...prev, [name]: value }));
  };

  const handleEdit = () => {
    if (!panel) return;
    setFormState({
      // panel_type is LOCKED on edit (matches PanelForm) — captured for display
      // / conditional logic only, never editable.
      panel_type: panel.panel_type ?? '',
      panel_status: panel.panel_status ?? '',
      xc_base: panel.xc_base ?? '',
      customer: panel.customer ?? '',
      customer_district: panel.customer_district ?? '',
      operating_company: panel.operating_company ?? '',
      unit_number: panel.unit_number ?? '',
      'so#': panel['so#'] ?? '',
      plus_panel: panel.plus_panel ?? '',
      shootingfw: panel.shootingfw ?? '',
      wl_controlfw: panel.wl_controlfw ?? '',
      loggingfw: panel.loggingfw ?? '',
      surfacefw: panel.surfacefw ?? '',
      gui_version: panel.gui_version ?? '',
      tracking_info: panel.tracking_info ?? '',
      rma: panel.rma ?? '',
      is_spare: panel.is_spare ?? '',
      verified: panel.verified ?? 'N',
      activity: panel.activity ?? 'N',
      comments: panel.comments ?? '',
      // Return workflow fields (editable for back-dating / corrections).
      returned_date: panel.returned_date ?? '',
      return_notes: panel.return_notes ?? '',
      return_confirmed_by: panel.return_confirmed_by ?? '',
      // Ship workflow field (date the panel was shipped out).
      shipped_date: panel.shipped_date ?? '',
    });
    setEditing(true);
  };

  const handleCancel = () => {
    setEditing(false);
    setFormState({});
  };

  // When customer changes in edit mode, clear the district (it belongs to the
  // old customer). Mirrors the cascade reset in PanelForm.
  const handleCustomerChange = (v: string) => {
    setFormState((prev: any) => ({ ...prev, customer: v, customer_district: '' }));
  };

  const handleSave = async () => {
    if (!id || !accessToken) return;
    setSaving(true);
    try {
      // panel_type is locked on edit, so use the stored value for conditional rules.
      const type   = panel.panel_type || '';
      // Auto-status: if a Returned Date was entered in edit mode (and there was
      // none before), the panel has come back to a XC facility — force the
      // status to 'At Facility' regardless of the dropdown (mirrors Mark Returned).
      const justReturned = !!form.returned_date && !panel.returned_date;
      const status = justReturned ? RETURNED_STATUS : (form.panel_status || '');
      // When the panel is being marked Shipped, stamp a ship date: use the one
      // entered, else default to today (plain wall-clock date column).
      const shippedDate = status === 'Shipped'
        ? (form.shipped_date || new Date().toISOString().slice(0, 10))
        : (form.shipped_date || null);
      const payload: Record<string, any> = {
        // panel_type intentionally NOT sent — locked after creation (PanelForm parity).
        panel_status: status || null,
        xc_base: form.xc_base || null,
        customer: form.customer || null,
        customer_district: form.customer_district || null,
        operating_company: form.operating_company || null,
        unit_number: form.unit_number || null,
        'so#': form['so#'] || null,
        // Conditional fields: only persist when applicable, else null (PanelForm parity).
        plus_panel: showPlusPanel(type) ? (form.plus_panel || null) : null,
        gui_version: showGui(type, status) ? (form.gui_version || null) : null,
        shootingfw: showShootingFw(type) ? (form.shootingfw || null) : null,
        surfacefw: showSurfaceFw(type) ? (form.surfacefw || null) : null,
        wl_controlfw: form.wl_controlfw || null,
        loggingfw: form.loggingfw || null,
        tracking_info: form.tracking_info || null,
        rma: form.rma || null,
        is_spare: form.is_spare || null,
        verified: form.verified || 'N',
        activity: form.activity || 'N',
        comments: form.comments || null,
        // Always stamp the saving user + today's date on edit (PanelForm parity).
        updated_by: user?.name || user?.email || null,
        date_updated: new Date().toLocaleDateString(),
        // Return workflow fields.
        returned_date: form.returned_date || null,
        return_notes: form.return_notes || null,
        return_confirmed_by: form.return_confirmed_by || null,
        // Ship workflow field.
        shipped_date: shippedDate,
        // Manufacturer-return / failure-report fields — carried forward so a
        // generic edit save doesn't blank them (no inputs for these here).
        failure_description: panel.failure_description ?? null,
        failure_date: panel.failure_date ?? null,
        failure_reported_by: panel.failure_reported_by ?? null,
        mfr_rma_date: panel.mfr_rma_date ?? null,
      };
      // At-Facility transition: clear customer/assignment fields and reset
      // verified/is_spare, overriding whatever the form had (mirrors edge net).
      if (status === RETURNED_STATUS) {
        payload.customer = null;
        payload.customer_district = null;
        payload.operating_company = null;
        payload.unit_number = null;
        payload.gui_version = null;
        payload.verified = 'Y';
        payload.is_spare = 'No';
      }
      await panelApi.update(id, payload, accessToken);
      toast.success('Panel updated successfully');
      setEditing(false);
      setFormState({});
      await loadPanel();
      await loadHistory();
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to save panel');
    } finally {
      setSaving(false);
    }
  };

  // ── Mark Returned ──────────────────────────────────────────────────────────
  // One-tap action: panel has come back to a XC facility. Stamps the returned
  // date (today by default, overridable), records who confirmed it + optional
  // notes, and auto-flips panel_status to 'At Facility'. Only offered for panels
  // that are out in the field (Leased / Loaned / In Repair).
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const handleMarkReturned = async () => {
    if (!id || !accessToken || !panel) return;
    setSaving(true);
    try {
      const who = user?.name || user?.email || null;
      const payload: Record<string, any> = {
        // Carry forward all existing values so the targeted update doesn't blank
        // unrelated columns (the edge PUT writes the whole object).
        panel_type: panel.panel_type ?? null,
        plus_panel: panel.plus_panel ?? null,
        serial_number: panel.serial_number ?? null,
        shootingfw: panel.shootingfw ?? null,
        wl_controlfw: panel.wl_controlfw ?? null,
        loggingfw: panel.loggingfw ?? null,
        surfacefw: panel.surfacefw ?? null,
        received_date: panel.received_date ?? null,
        xc_base: panel.xc_base ?? null,
        'so#': panel['so#'] ?? null,
        tracking_info: panel.tracking_info ?? null,
        comments: panel.comments ?? null,
        rma: panel.rma ?? null,
        activity: panel.activity ?? 'N',
        // Return workflow + auto-status.
        panel_status: RETURNED_STATUS,
        returned_date: returnDateInput || todayISO(),
        return_notes: returnNotesInput || null,
        return_confirmed_by: who,
        updated_by: who,
        date_updated: new Date().toLocaleDateString(),
        // At-Facility transition: clear customer/assignment fields and reset
        // verified/is_spare (mirrors handleSave + edge net).
        customer: null,
        customer_district: null,
        operating_company: null,
        unit_number: null,
        gui_version: null,
        verified: 'Y',
        is_spare: 'No',
      };
      await panelApi.update(id, payload, accessToken);
      toast.success(`Panel returned — status set to ${RETURNED_STATUS}`);
      setReturning(false);
      setReturnDateInput('');
      setReturnNotesInput('');
      await loadPanel();
      await loadHistory();
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to mark panel returned');
    } finally {
      setSaving(false);
    }
  };

  // ── Return to Manufacturer (RMA) ────────────────────────────────────────────
  // A failed panel ships back to the manufacturer (default "AWS"). Mirrors
  // handleMarkReturned's full carry-forward pattern (the edge PUT writes the
  // whole object) but sets status to 'In Repair' and stamps RMA / ship / failure
  // fields. The failure data persists in the 4 dedicated columns.
  const handleReturnToManufacturer = async () => {
    if (!id || !accessToken || !panel) return;
    setSaving(true);
    try {
      const who = user?.name || user?.email || null;
      const shipDate = mfrShipDateInput || todayISO();
      const payload: Record<string, any> = {
        // Carry forward all existing values so the whole-object PUT doesn't blank
        // unrelated columns.
        panel_type: panel.panel_type ?? null,
        plus_panel: panel.plus_panel ?? null,
        serial_number: panel.serial_number ?? null,
        shootingfw: panel.shootingfw ?? null,
        wl_controlfw: panel.wl_controlfw ?? null,
        loggingfw: panel.loggingfw ?? null,
        gui_version: panel.gui_version ?? null,
        surfacefw: panel.surfacefw ?? null,
        received_date: panel.received_date ?? null,
        xc_base: panel.xc_base ?? null,
        unit_number: panel.unit_number ?? null,
        'so#': panel['so#'] ?? null,
        comments: panel.comments ?? null,
        verified: panel.verified ?? 'N',
        is_spare: panel.is_spare ?? null,
        customer_district: panel.customer_district ?? null,
        operating_company: panel.operating_company ?? null,
        customer: panel.customer ?? null,
        activity: panel.activity ?? 'N',
        returned_date: panel.returned_date ?? null,
        return_notes: panel.return_notes ?? null,
        return_confirmed_by: panel.return_confirmed_by ?? null,
        // Manufacturer-return workflow.
        panel_status: 'In Repair',
        rma: mfrRmaInput || panel.rma || null,
        shipped_date: shipDate,
        tracking_info: mfrTrackingInput || panel.tracking_info || null,
        mfr_rma_date: shipDate,
        failure_description: failureDescInput || null,
        failure_date: failureDateInput || null,
        failure_reported_by: failureReportedByInput || who,
        updated_by: who,
        date_updated: new Date().toLocaleDateString(),
      };
      await panelApi.update(id, payload, accessToken);
      toast.success(`Panel marked In Repair — returned to ${mfrNameInput || 'manufacturer'}`);
      setReturningMfr(false);
      await loadPanel();
      await loadHistory();
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to return panel to manufacturer');
    } finally {
      setSaving(false);
    }
  };

  // Build & download the Repair / Failure Report PDF from the current form inputs
  // (falling back to stored panel values).
  const handleDownloadFailureReport = async () => {
    if (!panel) return;
    try {
      await generateRepairFailureReportPDF({
        manufacturer: mfrNameInput || 'AWS',
        rma: mfrRmaInput || panel.rma || undefined,
        shipDate: mfrShipDateInput || panel.shipped_date || undefined,
        trackingInfo: mfrTrackingInput || panel.tracking_info || undefined,
        panel: {
          serial_number: panel.serial_number,
          'serial#': panel['serial#'],
          panel_type: panel.panel_type,
          unit_number: panel.unit_number,
          panel_status: panel.panel_status,
          xc_base: panel.xc_base,
          shootingfw: panel.shootingfw,
          wl_controlfw: panel.wl_controlfw,
          loggingfw: panel.loggingfw,
          surfacefw: panel.surfacefw,
          gui_version: panel.gui_version,
          received_date: panel.received_date,
        },
        failureDescription: failureDescInput || panel.failure_description || undefined,
        failureDate: failureDateInput || panel.failure_date || undefined,
        reportedBy: failureReportedByInput || panel.failure_reported_by || user?.name || user?.email || undefined,
      });
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to generate report');
    }
  };

  // Mark this panel as seen right now: sets verified='Y' and stamps the
  // last-seen audit trail (date = now, by = current user). Uses the dedicated
  // mark-seen route so it never touches other panel columns.
  const handleMarkSeen = async () => {
    if (!id || !accessToken || !panel) return;
    setSeenSaving(true);
    try {
      const who = user?.name || user?.email || null;
      await panelApi.markSeen(id, { seen_by: who, seen_date: new Date().toISOString(), visit_id: null }, accessToken);
      toast.success('Panel marked seen — Verified set to Y');
      await loadPanel();
      await loadHistory();
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to mark panel seen');
    } finally {
      setSeenSaving(false);
    }
  };

  // ── Loading / not-found states ─────────────────────────────────────────────
  if (loading) {
    return (
      <div className="p-8">
        <div className="max-w-5xl mx-auto text-center py-12">Loading...</div>
      </div>
    );
  }

  if (!panel) {
    return (
      <div className="p-8">
        <div className="max-w-5xl mx-auto text-center py-12">
          <p className="text-gray-500 mb-4">Panel not found</p>
          <Button onClick={() => navigate('/panels')}>Back to Panels</Button>
        </div>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* Hero header */}
        <div className="rounded-xl border dark:border-slate-700 bg-gradient-to-br from-slate-50 to-white dark:from-slate-800 dark:to-slate-900 p-6 shadow-sm">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/panels')}
            className="mb-4 -ml-2"
          >
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back to Panels
          </Button>

          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {panel.serial_number || 'Panel Detail'}
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {panel.panel_type || 'Unknown type'} &mdash; {panel.xc_base || 'No base'}
              </p>
            </div>

            <div className="flex items-center gap-3 flex-shrink-0">
              <Badge className={getStatusColor(panel.panel_status)}>
                {panel.panel_status || 'Unknown'}
              </Badge>

              {!editing ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleMarkSeen}
                    disabled={seenSaving}
                    title="Set Verified = Y and stamp last-seen now"
                  >
                    {seenSaving ? (
                      <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                    ) : (
                      <Eye className="w-4 h-4 mr-1" />
                    )}
                    Mark Seen
                  </Button>
                  <Button size="sm" onClick={handleEdit}>
                    <Pencil className="w-4 h-4 mr-1" />
                    Edit
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleCancel}
                    disabled={saving}
                  >
                    <X className="w-4 h-4 mr-1" />
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleSave} disabled={saving}>
                    {saving ? (
                      <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4 mr-1" />
                    )}
                    Save
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* ── Main column ── */}
          <div className="lg:col-span-2 space-y-6">

            {/* Panel Information */}
            <Card className="rounded-xl">
              <CardHeader>
                <CardTitle>Panel Information</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid sm:grid-cols-2 gap-x-6 gap-y-4">
                  {/* Panel Type is LOCKED after creation (PanelForm parity) —
                      always read-only, even in edit mode. */}
                  <Field label="Panel Type" value={panel.panel_type} />

                  <Field
                    label="Panel Status"
                    value={panel.panel_status}
                    editing={editing}
                  >
                    <Sel
                      value={form.panel_status}
                      onChange={(v) => setField('panel_status', v)}
                      opts={PANEL_STATUS_OPTS}
                      placeholder="Select status"
                    />
                  </Field>

                  {/* Customer (FK) — editable select with district cascade. */}
                  <Field
                    label="Customer"
                    value={panel.customerName}
                    editing={editing}
                  >
                    <select
                      value={form.customer ?? ''}
                      onChange={(e) => handleCustomerChange(e.target.value)}
                      className="w-full border border-gray-300 dark:border-gray-600 rounded-md p-2 text-sm"
                    >
                      <option value="">— Not assigned —</option>
                      {customers.map((c) => (
                        <option key={c.row_id} value={c.row_id}>{c.customer}</option>
                      ))}
                    </select>
                  </Field>

                  {/* District (FK) — cascades off selected customer. */}
                  <Field
                    label="District"
                    value={panel.districtName}
                    editing={editing}
                  >
                    <select
                      value={form.customer_district ?? ''}
                      onChange={(e) => setField('customer_district', e.target.value)}
                      disabled={!form.customer}
                      className="w-full border border-gray-300 dark:border-gray-600 rounded-md p-2 text-sm"
                    >
                      <option value="">— Not assigned —</option>
                      {districts.map((d) => (
                        <option key={d.row_id} value={d.row_id}>{d.customer_district}</option>
                      ))}
                    </select>
                  </Field>

                  {/* Operating Company (FK from ep table). */}
                  <Field
                    label="Operating Company"
                    value={panel.operating_company}
                    editing={editing}
                  >
                    <Combobox
                      value={form.operating_company ?? ''}
                      onValueChange={(v) => setField('operating_company', v)}
                      options={epCompanies.map((o) => ({ value: o, label: o }))}
                      placeholder="— Select —"
                      searchPlaceholder="Search operating companies…"
                      emptyText="No operating companies found."
                      allowClear
                    />
                  </Field>

                  <Field
                    label="XC Base"
                    value={panel.xc_base}
                    editing={editing}
                  >
                    <Sel
                      value={form.xc_base}
                      onChange={(v) => setField('xc_base', v)}
                      opts={XC_BASE_OPTS}
                      placeholder="Select base"
                    />
                  </Field>

                  <Field
                    label="Unit Number"
                    value={panel.unit_number}
                    editing={editing}
                  >
                    <Input
                      value={form.unit_number}
                      onChange={(e) => setField('unit_number', e.target.value)}
                    />
                  </Field>

                  <Field
                    label="SO #"
                    value={panel['so#']}
                    editing={editing}
                  >
                    <Input
                      value={form['so#']}
                      onChange={(e) => setField('so#', e.target.value)}
                    />
                  </Field>

                  {/* Plus Panel — only applies to P2500 (PanelForm parity). */}
                  {showPlusPanel(panel.panel_type) && (
                    <Field
                      label="Plus Panel"
                      value={panel.plus_panel}
                      editing={editing}
                    >
                      <Sel
                        value={form.plus_panel}
                        onChange={(v) => setField('plus_panel', v)}
                        opts={YES_NO_OPTS}
                        placeholder="Select"
                      />
                    </Field>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Firmware Versions */}
            <Card className="rounded-xl">
              <CardHeader>
                <CardTitle>Firmware Versions</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid sm:grid-cols-2 gap-x-6 gap-y-4">
                  {/* Shooting FW — only for Digital Shooting Panel (PanelForm parity). */}
                  {showShootingFw(panel.panel_type) && (
                    <Field
                      label="Shooting FW"
                      value={panel.shootingfw}
                      editing={editing}
                    >
                      <Input
                        value={form.shootingfw}
                        onChange={(e) => setField('shootingfw', e.target.value)}
                      />
                    </Field>
                  )}

                  <Field
                    label="WL Control FW"
                    value={panel.wl_controlfw}
                    editing={editing}
                  >
                    <Input
                      value={form.wl_controlfw}
                      onChange={(e) => setField('wl_controlfw', e.target.value)}
                    />
                  </Field>

                  <Field
                    label="Logging FW"
                    value={panel.loggingfw}
                    editing={editing}
                  >
                    <Input
                      value={form.loggingfw}
                      onChange={(e) => setField('loggingfw', e.target.value)}
                    />
                  </Field>

                  {/* Surface FW — only for Surface Tester (PanelForm parity). */}
                  {showSurfaceFw(panel.panel_type) && (
                    <Field
                      label="Surface FW"
                      value={panel.surfacefw}
                      editing={editing}
                    >
                      <Input
                        value={form.surfacefw}
                        onChange={(e) => setField('surfacefw', e.target.value)}
                      />
                    </Field>
                  )}

                  {/* GUI Version — only for GUI panel types in Leased/Loaned status
                      (PanelForm parity). While editing, use the in-progress status. */}
                  {showGui(panel.panel_type, editing ? form.panel_status : panel.panel_status) && (
                    <Field
                      label="GUI Version"
                      value={panel.gui_version}
                      editing={editing}
                    >
                      <Input
                        value={form.gui_version}
                        onChange={(e) => setField('gui_version', e.target.value)}
                      />
                    </Field>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Tracking & Status */}
            <Card className="rounded-xl">
              <CardHeader>
                <CardTitle>Tracking &amp; Status</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid sm:grid-cols-2 gap-x-6 gap-y-4">
                  <Field
                    label="RMA"
                    value={panel.rma}
                    editing={editing}
                  >
                    <Input
                      value={form.rma}
                      onChange={(e) => setField('rma', e.target.value)}
                    />
                  </Field>

                  <Field
                    label="Is Spare?"
                    value={panel.is_spare}
                    editing={editing}
                  >
                    <Sel
                      value={form.is_spare}
                      onChange={(v) => setField('is_spare', v)}
                      opts={['Yes', 'No']}
                      placeholder="Select"
                    />
                  </Field>

                  <Field
                    label="Verified"
                    value={panel.verified}
                    editing={editing}
                  >
                    <Sel
                      value={form.verified}
                      onChange={(v) => setField('verified', v)}
                      opts={['Y', 'N']}
                      placeholder="Select"
                    />
                  </Field>

                  <Field
                    label="Last Seen"
                    value={panel.last_seen_date ? new Date(panel.last_seen_date).toLocaleDateString() : ''}
                  />

                  <Field
                    label="Last Seen By"
                    value={panel.last_seen_by}
                  />

                  <Field
                    label="Activity"
                    value={panel.activity}
                    editing={editing}
                  >
                    <Sel
                      value={form.activity}
                      onChange={(v) => setField('activity', v)}
                      opts={['Y', 'N']}
                      placeholder="Select"
                    />
                  </Field>

                  {/* Return fields — editable for back-dating / corrections.
                      Setting a Returned Date here auto-flips status to
                      'At Facility' on save (see handleSave justReturned). */}
                  <Field
                    label="Returned Date"
                    value={
                      panel.returned_date
                        ? new Date(panel.returned_date).toLocaleDateString()
                        : '—'
                    }
                    editing={editing}
                  >
                    <Input
                      type="date"
                      value={form.returned_date}
                      onChange={(e) => setField('returned_date', e.target.value)}
                    />
                  </Field>

                  <Field
                    label="Return Confirmed By"
                    value={panel.return_confirmed_by}
                    editing={editing}
                  >
                    <Input
                      value={form.return_confirmed_by}
                      onChange={(e) => setField('return_confirmed_by', e.target.value)}
                    />
                  </Field>

                  <Field
                    label="Return Notes"
                    value={panel.return_notes}
                    editing={editing}
                  >
                    <Textarea
                      rows={2}
                      value={form.return_notes}
                      onChange={(e) => setField('return_notes', e.target.value)}
                    />
                  </Field>

                  {/* Ship Date — shown when the panel is (being) marked Shipped.
                      Destination is captured via the Customer / District /
                      Operating Company fields above. */}
                  {(editing ? form.panel_status === 'Shipped' : panel.panel_status === 'Shipped') && (
                    <Field
                      label="Ship Date"
                      value={
                        panel.shipped_date
                          ? new Date(panel.shipped_date).toLocaleDateString()
                          : '—'
                      }
                      editing={editing}
                    >
                      <Input
                        type="date"
                        value={form.shipped_date}
                        onChange={(e) => setField('shipped_date', e.target.value)}
                      />
                    </Field>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Comments */}
            <Card className="rounded-xl">
              <CardHeader>
                <CardTitle>Comments</CardTitle>
              </CardHeader>
              <CardContent>
                {editing ? (
                  <Textarea
                    value={form.comments}
                    onChange={(e) => setField('comments', e.target.value)}
                    rows={4}
                    className="w-full"
                  />
                ) : (
                  <div className="bg-gray-50 dark:bg-gray-800/50 p-4 rounded-lg min-h-[60px]">
                    <pre className="whitespace-pre-wrap text-sm text-gray-900 dark:text-gray-100 font-sans">
                      {panel.comments || '—'}
                    </pre>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Change History — field-level diffs from panel_change_log. */}
            <Card className="rounded-xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <History className="w-4 h-4 text-gray-500" />
                  Change History
                </CardTitle>
              </CardHeader>
              <CardContent>
                {historyLoading ? (
                  <div className="flex items-center gap-2 text-sm text-gray-500 py-4">
                    <Loader2 className="w-4 h-4 animate-spin" /> Loading history…
                  </div>
                ) : history.length === 0 ? (
                  <p className="text-sm text-gray-500 py-4">
                    No changes recorded yet. Edits made from here on are tracked automatically.
                  </p>
                ) : (
                  <ol className="relative border-l border-gray-200 dark:border-gray-700 ml-2 space-y-4">
                    {history.map((h) => {
                      const isSnapshot = h.entry_type === 'snapshot';
                      return (
                        <li key={h.id} className="ml-4">
                          <span
                            className={`absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-white dark:border-gray-900 ${isSnapshot ? 'bg-amber-400' : 'bg-blue-500'}`}
                          />
                          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                              {h.field_label}
                            </span>
                            {isSnapshot && (
                              <span className="text-[10px] uppercase tracking-wide font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                                Legacy
                              </span>
                            )}
                            <span className="text-xs text-gray-400">
                              {fmtWhen(h.changed_at)}
                              {h.changed_by ? ` · ${h.changed_by}` : ''}
                            </span>
                          </div>
                          {isSnapshot ? (
                            <div className="text-sm mt-0.5 text-gray-600 dark:text-gray-300 break-words">
                              {h.new_value || '—'}
                            </div>
                          ) : (
                            <div className="text-sm mt-0.5 flex flex-wrap items-center gap-1.5">
                              <span className="line-through text-gray-400 break-all">
                                {displayValue(h.field, h.old_value)}
                              </span>
                              <span className="text-gray-400">→</span>
                              <span className="font-medium text-gray-900 dark:text-gray-100 break-all">
                                {displayValue(h.field, h.new_value)}
                              </span>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                )}
              </CardContent>
            </Card>

            {/* Images */}
            {panel?.row_id && (
              <Card className="rounded-xl">
                <CardHeader>
                  <CardTitle>Images</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <ImageUpload
                    parentTable="panels"
                    parentRowId={panel.row_id}
                    baseUrl={`https://${projectId}.supabase.co/functions/v1/make-server-64775d98`}
                    publicAnonKey={publicAnonKey}
                    autoLoad
                    maxImages={10}
                  />
                </CardContent>
              </Card>
            )}
          </div>

          {/* ── Right sidebar ── */}
          <div className="space-y-6">

            {/* Mark Returned — hero action. Only for panels currently out in the
                field (Leased / Loaned / In Repair). Returning auto-sets the
                status to 'At Facility'. Sold panels never return. */}
            {!editing && RETURNABLE_STATUSES.includes(panel.panel_status) && (
              <div className="rounded-xl border border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-900 p-5 shadow-sm">
                <div className="flex items-center gap-2 text-blue-700 dark:text-blue-300">
                  <PackageCheck className="w-4 h-4" />
                  <span className="text-xs font-semibold uppercase tracking-wide">
                    Panel Return
                  </span>
                </div>
                <p className="mt-2 text-sm text-blue-900/80 dark:text-blue-200/80">
                  Currently <span className="font-semibold">{panel.panel_status}</span>.
                  Mark it returned when it&rsquo;s back at a XC facility &mdash;
                  status will switch to <span className="font-semibold">{RETURNED_STATUS}</span>.
                </p>

                {!returning ? (
                  <Button
                    className="mt-4 w-full bg-blue-600 hover:bg-blue-700 text-white"
                    onClick={() => {
                      setReturnDateInput('');
                      setReturnNotesInput('');
                      setReturning(true);
                    }}
                  >
                    <PackageCheck className="w-4 h-4 mr-2" />
                    Mark Returned
                  </Button>
                ) : (
                  <div className="mt-4 space-y-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-blue-900/70 dark:text-blue-200/70">
                        Returned Date (defaults to today)
                      </Label>
                      <Input
                        type="date"
                        value={returnDateInput}
                        onChange={(e) => setReturnDateInput(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-blue-900/70 dark:text-blue-200/70">
                        Return Notes
                      </Label>
                      <Textarea
                        rows={3}
                        value={returnNotesInput}
                        onChange={(e) => setReturnNotesInput(e.target.value)}
                        placeholder="Condition, who dropped it off, etc."
                      />
                    </div>

                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        className="flex-1"
                        onClick={() => {
                          setReturning(false);
                          setReturnDateInput('');
                          setReturnNotesInput('');
                        }}
                        disabled={saving}
                      >
                        <X className="w-4 h-4 mr-1" />
                        Cancel
                      </Button>
                      <Button
                        className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                        onClick={handleMarkReturned}
                        disabled={saving}
                      >
                        {saving ? (
                          <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        ) : (
                          <PackageCheck className="w-4 h-4 mr-1" />
                        )}
                        Confirm Return
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Return to Manufacturer (RMA) — a failed panel ships back to the
                manufacturer (default AWS). Offered for any panel not Sold.
                Sets status to 'In Repair' and stamps RMA / failure fields. */}
            {!editing && panel.panel_status !== 'Sold' && (
              <div className="rounded-xl border border-orange-200 bg-orange-50 dark:bg-orange-950/30 dark:border-orange-900 p-5 shadow-sm">
                <div className="flex items-center gap-2 text-orange-700 dark:text-orange-300">
                  <PackageX className="w-4 h-4" />
                  <span className="text-xs font-semibold uppercase tracking-wide">
                    Return to Manufacturer
                  </span>
                </div>
                <p className="mt-2 text-sm text-orange-900/80 dark:text-orange-200/80">
                  Ship a failed panel back to the manufacturer for repair &mdash;
                  status will switch to <span className="font-semibold">In Repair</span>.
                </p>

                {!returningMfr ? (
                  <Button
                    className="mt-4 w-full bg-orange-600 hover:bg-orange-700 text-white"
                    onClick={() => {
                      setMfrNameInput('AWS');
                      setMfrRmaInput(panel.rma || '');
                      setMfrShipDateInput(todayISO());
                      setMfrTrackingInput(panel.tracking_info || '');
                      setFailureDescInput(panel.failure_description || '');
                      setFailureDateInput(panel.failure_date || todayISO());
                      setFailureReportedByInput(panel.failure_reported_by || user?.name || user?.email || '');
                      setReturningMfr(true);
                    }}
                  >
                    <PackageX className="w-4 h-4 mr-2" />
                    Return to Manufacturer
                  </Button>
                ) : (
                  <div className="mt-4 space-y-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-orange-900/70 dark:text-orange-200/70">Manufacturer</Label>
                      <Input value={mfrNameInput} onChange={(e) => setMfrNameInput(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-orange-900/70 dark:text-orange-200/70">RMA #</Label>
                      <Input value={mfrRmaInput} onChange={(e) => setMfrRmaInput(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-orange-900/70 dark:text-orange-200/70">Ship Date</Label>
                      <Input type="date" value={mfrShipDateInput} onChange={(e) => setMfrShipDateInput(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-orange-900/70 dark:text-orange-200/70">Tracking #</Label>
                      <Input value={mfrTrackingInput} onChange={(e) => setMfrTrackingInput(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-orange-900/70 dark:text-orange-200/70">Failure Description</Label>
                      <Textarea
                        rows={3}
                        value={failureDescInput}
                        onChange={(e) => setFailureDescInput(e.target.value)}
                        placeholder="What failed and how it was observed…"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-orange-900/70 dark:text-orange-200/70">Failure Date</Label>
                      <Input type="date" value={failureDateInput} onChange={(e) => setFailureDateInput(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-orange-900/70 dark:text-orange-200/70">Reported By</Label>
                      <Input value={failureReportedByInput} onChange={(e) => setFailureReportedByInput(e.target.value)} />
                    </div>

                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={handleDownloadFailureReport}
                    >
                      <FileDown className="w-4 h-4 mr-2" />
                      Download Failure Report
                    </Button>

                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        className="flex-1"
                        onClick={() => setReturningMfr(false)}
                        disabled={saving}
                      >
                        <X className="w-4 h-4 mr-1" />
                        Cancel
                      </Button>
                      <Button
                        className="flex-1 bg-orange-600 hover:bg-orange-700 text-white"
                        onClick={handleReturnToManufacturer}
                        disabled={saving}
                      >
                        {saving ? (
                          <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        ) : (
                          <Save className="w-4 h-4 mr-1" />
                        )}
                        Save &amp; Mark In Repair
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Return details — shown once a panel has been returned. */}
            {!editing && panel.returned_date && (
              <Card className="rounded-xl">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <PackageCheck className="w-4 h-4 text-blue-600" />
                    Return Details
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Field
                    label="Returned Date"
                    value={
                      panel.returned_date
                        ? new Date(panel.returned_date).toLocaleDateString()
                        : '—'
                    }
                  />
                  <Field label="Confirmed By" value={panel.return_confirmed_by} />
                  <Field label="Return Notes" value={panel.return_notes} />
                </CardContent>
              </Card>
            )}

            <Card className="rounded-xl">
              <CardHeader>
                <CardTitle>Metadata</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Field label="Serial Number" value={panel.serial_number} />
                <Field label="Customer" value={panel.customerName} />
                <Field label="District" value={panel.districtName} />
                <Field
                  label="Received Date"
                  value={
                    panel.received_date
                      ? new Date(panel.received_date).toLocaleDateString()
                      : '—'
                  }
                />
                <Field
                  label="Last Updated"
                  value={
                    panel.date_updated
                      ? new Date(panel.date_updated).toLocaleDateString()
                      : '—'
                  }
                />
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                    Status
                  </p>
                  <Badge className={getStatusColor(panel.panel_status)}>
                    {panel.panel_status || 'Unknown'}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          </div>

        </div>
      </div>
    </div>
  );
}
