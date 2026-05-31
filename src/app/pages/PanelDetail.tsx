import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useAuth } from '../lib/auth-context';
import { detailApi, panelApi } from '../lib/api';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { ArrowLeft, Pencil, Save, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import ImageUpload from '../components/ImageUpload';
import { projectId, publicAnonKey } from '../../../utils/supabase/info';

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

const XC_BASE_OPTS = ['Denver', 'Midland', 'Williston'];

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
        <p className="text-sm text-gray-900">{value || '—'}</p>
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
      className="w-full border border-gray-300 rounded-md p-2 text-sm"
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
  const { accessToken } = useAuth();

  const [panel, setPanel] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setFormState] = useState<any>({});

  useEffect(() => {
    loadPanel();
  }, [id]);

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

  const setField = (name: string, value: any) => {
    setFormState((prev: any) => ({ ...prev, [name]: value }));
  };

  const handleEdit = () => {
    if (!panel) return;
    setFormState({
      panel_type: panel.panel_type ?? '',
      panel_status: panel.panel_status ?? '',
      xc_base: panel.xc_base ?? '',
      unit_number: panel.unit_number ?? '',
      'so#': panel['so#'] ?? '',
      plus_panel: panel.plus_panel ?? '',
      shootingfw: panel.shootingfw ?? '',
      wl_controlfw: panel.wl_controlfw ?? '',
      loggingfw: panel.loggingfw ?? '',
      surfacefw: panel.surfacefw ?? '',
      gui_version: panel.gui_version ?? '',
      rma: panel.rma ?? '',
      is_spare: panel.is_spare ?? '',
      verified: panel.verified ?? '',
      activity: panel.activity ?? '',
      comments: panel.comments ?? '',
    });
    setEditing(true);
  };

  const handleCancel = () => {
    setEditing(false);
    setFormState({});
  };

  const handleSave = async () => {
    if (!id || !accessToken) return;
    setSaving(true);
    try {
      const payload = {
        panel_type: form.panel_type,
        panel_status: form.panel_status,
        xc_base: form.xc_base,
        unit_number: form.unit_number,
        'so#': form['so#'],
        plus_panel: form.plus_panel,
        shootingfw: form.shootingfw,
        wl_controlfw: form.wl_controlfw,
        loggingfw: form.loggingfw,
        surfacefw: form.surfacefw,
        gui_version: form.gui_version,
        rma: form.rma,
        is_spare: form.is_spare,
        verified: form.verified,
        activity: form.activity,
        comments: form.comments,
      };
      await panelApi.update(id, payload, accessToken);
      toast.success('Panel updated successfully');
      setEditing(false);
      setFormState({});
      await loadPanel();
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
              <h1 className="text-2xl font-bold text-gray-900">
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
                  {/* Read-only */}
                  <Field label="Customer" value={panel.customerName} />
                  <Field label="District" value={panel.districtName} />

                  <Field
                    label="Panel Type"
                    value={panel.panel_type}
                    editing={editing}
                  >
                    <Sel
                      value={form.panel_type}
                      onChange={(v) => setField('panel_type', v)}
                      opts={PANEL_TYPE_OPTS}
                      placeholder="Select type"
                    />
                  </Field>

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

                  <Field
                    label="Plus Panel"
                    value={panel.plus_panel}
                    editing={editing}
                  >
                    <Input
                      value={form.plus_panel}
                      onChange={(e) => setField('plus_panel', e.target.value)}
                    />
                  </Field>
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
                  <div className="bg-gray-50 p-4 rounded-lg min-h-[60px]">
                    <pre className="whitespace-pre-wrap text-sm text-gray-900 font-sans">
                      {panel.comments || '—'}
                    </pre>
                  </div>
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
