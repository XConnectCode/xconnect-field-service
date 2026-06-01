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
import { Textarea } from '../components/ui/textarea';
import { ArrowLeft, Pencil, Save, X, Loader2, History } from 'lucide-react';
import { toast } from 'sonner';
import ImageUpload from '../components/ImageUpload';
import { projectId, publicAnonKey } from '../../../utils/supabase/info';
import { XC_PANEL_BASES } from '../lib/xcLocations';

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
];

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
    case 'at facility': return 'bg-blue-100 text-blue-800';
    case 'leased': return 'bg-green-100 text-green-800';
    case 'in repair': return 'bg-orange-100 text-orange-800';
    case 'loaned': return 'bg-yellow-100 text-yellow-800';
    case 'sold': return 'bg-gray-100 text-gray-800';
    // legacy values kept for backwards compat
    case 'installed': return 'bg-green-100 text-green-800';
    case 'in stock': return 'bg-blue-100 text-blue-800';
    case 'in transit': return 'bg-yellow-100 text-yellow-800';
    case 'maintenance': return 'bg-orange-100 text-orange-800';
    default: return 'bg-gray-100 text-gray-800';
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
      const status = form.panel_status || '';
      const payload: Record<string, any> = {
        // panel_type intentionally NOT sent — locked after creation (PanelForm parity).
        panel_status: form.panel_status || null,
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
      };
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
        <div className="rounded-xl border bg-gradient-to-br from-slate-50 to-white p-6 shadow-sm">
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
              <p className="text-sm text-gray-500 mt-1">
                {panel.panel_type || 'Unknown type'} &mdash; {panel.xc_base || 'No base'}
              </p>
            </div>

            <div className="flex items-center gap-3 flex-shrink-0">
              <Badge className={getStatusColor(panel.panel_status)}>
                {panel.panel_status || 'Unknown'}
              </Badge>

              {!editing ? (
                <Button size="sm" onClick={handleEdit}>
                  <Pencil className="w-4 h-4 mr-1" />
                  Edit
                </Button>
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
                    <select
                      value={form.operating_company ?? ''}
                      onChange={(e) => setField('operating_company', e.target.value)}
                      className="w-full border border-gray-300 dark:border-gray-600 rounded-md p-2 text-sm"
                    >
                      <option value="">— Select —</option>
                      {epCompanies.map((o) => (
                        <option key={o} value={o}>{o}</option>
                      ))}
                    </select>
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
