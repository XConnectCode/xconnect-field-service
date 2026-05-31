import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useAuth } from '../lib/auth-context';
import { detailApi, fieldVisitApi } from '../lib/api';
import { supabase } from '../lib/supabase';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import {
  ArrowLeft,
  AlertTriangle,
  ExternalLink,
  Pencil,
  Save,
  X,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';

// ── constants ─────────────────────────────────────────────────────────────────
const VISIT_PURPOSE_OPTS = [
  'XFire Installation',
  'Training',
  'Sales',
  'R&D',
  'Incident',
  'Impromptu',
  'Follow Up/Check Up',
  'Delivery/Pickup',
];

const FIELD_OR_FACILITY_OPTS = ['Field', 'Facility'];

// ── Field helper ──────────────────────────────────────────────────────────────
interface FieldProps {
  label: string;
  value: string | null | undefined;
  editing: boolean;
  children?: React.ReactNode; // edit-mode input; omit to make read-only
}

function Field({ label, value, editing, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
        {label}
      </span>
      {editing && children ? (
        children
      ) : (
        <p className="text-sm text-gray-900">{value || '—'}</p>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function FieldVisitDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { accessToken } = useAuth();

  const [visit, setVisit] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [relatedIncidents, setRelatedIncidents] = useState<any[]>([]);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<any>({});

  // ── data loading ────────────────────────────────────────────────────────────
  useEffect(() => {
    loadVisit();
  }, [id]);

  const loadVisit = async () => {
    if (!id || !accessToken) {
      setLoading(false);
      return;
    }
    try {
      const data = await detailApi.getFieldVisit(id, accessToken);
      setVisit(data);

      // Load related incidents (by business field_visit_id)
      if (data?.field_visit_id) {
        const { data: inc } = await supabase
          .from('incidents')
          .select(
            'row_id, event_id, date_incident, incident_status, incident_severity, incident_description'
          )
          .eq('field_visit_id', data.field_visit_id)
          .order('date_incident', { ascending: false });
        setRelatedIncidents(inc || []);
      } else {
        setRelatedIncidents([]);
      }
    } catch (error: any) {
      console.error('Error loading field visit:', error);
      toast.error('Failed to load field visit details');
    } finally {
      setLoading(false);
    }
  };

  // ── edit helpers ────────────────────────────────────────────────────────────
  function enterEdit() {
    if (!visit) return;
    setForm({
      visit_purpose: visit.visit_purpose ?? '',
      field_or_facility: visit.field_or_facility ?? '',
      arrival_date: visit.arrival_date ?? '',
      departure_date: visit.departure_date ?? '',
      visit_duration: visit.visit_duration ?? '',
      customer_rep: visit.customer_rep ?? '',
      xc_rep: visit.xc_rep ?? '',
      operating_company: visit.operating_company ?? '',
      pad_name: visit.pad_name ?? '',
      lat_long: visit.lat_long ?? '',
      communication_panel: visit.communication_panel ?? '',
      digital_shooting_panel: visit.digital_shooting_panel ?? '',
      surface_tester: visit.surface_tester ?? '',
      visit_summary: visit.visit_summary ?? '',
    });
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setForm({});
  }

  function setField(name: string, value: string) {
    setForm((prev: any) => ({ ...prev, [name]: value }));
  }

  async function handleSave() {
    if (!id || !accessToken) return;
    setSaving(true);
    try {
      const payload = {
        visit_purpose: form.visit_purpose,
        field_or_facility: form.field_or_facility,
        arrival_date: form.arrival_date,
        departure_date: form.departure_date,
        visit_duration: form.visit_duration,
        customer_rep: form.customer_rep,
        xc_rep: form.xc_rep,
        operating_company: form.operating_company,
        pad_name: form.pad_name,
        lat_long: form.lat_long,
        communication_panel: form.communication_panel,
        digital_shooting_panel: form.digital_shooting_panel,
        surface_tester: form.surface_tester,
        visit_summary: form.visit_summary,
      };
      await fieldVisitApi.update(id, payload, accessToken);
      toast.success('Field visit updated successfully');
      setEditing(false);
      setForm({});
      await loadVisit();
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to save field visit');
    } finally {
      setSaving(false);
    }
  }

  // ── loading / not-found states ──────────────────────────────────────────────
  if (loading) {
    return (
      <div className="p-8">
        <div className="max-w-5xl mx-auto text-center py-12">Loading...</div>
      </div>
    );
  }

  if (!visit) {
    return (
      <div className="p-8">
        <div className="max-w-5xl mx-auto text-center py-12">
          <p className="text-gray-500 mb-4">Field visit not found</p>
          <Button onClick={() => navigate('/field-visits')}>
            Back to Field Visits
          </Button>
        </div>
      </div>
    );
  }

  // ── format helpers ──────────────────────────────────────────────────────────
  function fmtDate(val: string | null | undefined) {
    if (!val) return '—';
    try {
      return new Date(val).toLocaleString();
    } catch {
      return val;
    }
  }

  // ── render ──────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* ── Hero header ───────────────────────────────────────────────── */}
        <div className="rounded-xl border bg-gradient-to-br from-slate-50 to-white p-6 shadow-sm">
          {/* Back button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/field-visits')}
            className="mb-4 -ml-1 text-gray-600 hover:text-gray-900"
          >
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back to Field Visits
          </Button>

          {/* Title row */}
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            {/* Left: title block */}
            <div>
              <h1 className="text-2xl font-bold text-gray-900 leading-tight">
                Field Visit
              </h1>
              <p className="text-gray-500 mt-0.5 text-sm">
                {visit.field_visit_id || 'N/A'} &mdash;{' '}
                {visit.customerName || 'Unknown Customer'}
              </p>
            </div>

            {/* Right: badge + actions */}
            <div className="flex items-center gap-3 flex-shrink-0">
              {visit.visit_purpose && (
                <Badge variant="secondary">{visit.visit_purpose}</Badge>
              )}
              {!editing ? (
                <Button size="sm" onClick={enterEdit}>
                  <Pencil className="w-3.5 h-3.5 mr-1.5" />
                  Edit
                </Button>
              ) : (
                <>
                  <Button
                    size="sm"
                    onClick={handleSave}
                    disabled={saving}
                  >
                    {saving ? (
                      <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    ) : (
                      <Save className="w-3.5 h-3.5 mr-1.5" />
                    )}
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={cancelEdit}
                    disabled={saving}
                  >
                    <X className="w-3.5 h-3.5 mr-1.5" />
                    Cancel
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── Two-column layout ─────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* ── Main column (2/3) ──────────────────────────────────────── */}
          <div className="lg:col-span-2 space-y-6">

            {/* Section: Visit Information */}
            <Card className="rounded-xl">
              <CardHeader>
                <CardTitle className="text-base">Visit Information</CardTitle>
              </CardHeader>
              <CardContent className="grid sm:grid-cols-2 gap-x-6 gap-y-4">
                <Field
                  label="Visit Purpose"
                  value={visit.visit_purpose}
                  editing={editing}
                >
                  <select
                    value={form.visit_purpose}
                    onChange={(e) => setField('visit_purpose', e.target.value)}
                    className="w-full border border-gray-300 rounded-md p-2 text-sm"
                  >
                    <option value="">Select purpose…</option>
                    {VISIT_PURPOSE_OPTS.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field
                  label="Field or Facility"
                  value={visit.field_or_facility}
                  editing={editing}
                >
                  <select
                    value={form.field_or_facility}
                    onChange={(e) =>
                      setField('field_or_facility', e.target.value)
                    }
                    className="w-full border border-gray-300 rounded-md p-2 text-sm"
                  >
                    <option value="">Select…</option>
                    {FIELD_OR_FACILITY_OPTS.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field
                  label="Arrival Date"
                  value={fmtDate(visit.arrival_date)}
                  editing={editing}
                >
                  <Input
                    type="datetime-local"
                    value={form.arrival_date ? form.arrival_date.slice(0, 16) : ''}
                    onChange={(e) => setField('arrival_date', e.target.value)}
                    className="text-sm"
                  />
                </Field>

                <Field
                  label="Departure Date"
                  value={fmtDate(visit.departure_date)}
                  editing={editing}
                >
                  <Input
                    type="datetime-local"
                    value={
                      form.departure_date
                        ? form.departure_date.slice(0, 16)
                        : ''
                    }
                    onChange={(e) => setField('departure_date', e.target.value)}
                    className="text-sm"
                  />
                </Field>

                <Field
                  label="Visit Duration"
                  value={visit.visit_duration ? `${visit.visit_duration} hours` : '—'}
                  editing={editing}
                >
                  <Input
                    value={form.visit_duration}
                    onChange={(e) => setField('visit_duration', e.target.value)}
                    placeholder="e.g. 4"
                    className="text-sm"
                  />
                </Field>

                <Field
                  label="XC Representative"
                  value={visit.xc_rep}
                  editing={editing}
                >
                  <Input
                    value={form.xc_rep}
                    onChange={(e) => setField('xc_rep', e.target.value)}
                    className="text-sm"
                  />
                </Field>

                <Field
                  label="Customer Representative"
                  value={visit.customer_rep}
                  editing={editing}
                >
                  <Input
                    value={form.customer_rep}
                    onChange={(e) => setField('customer_rep', e.target.value)}
                    className="text-sm"
                  />
                </Field>
              </CardContent>
            </Card>

            {/* Section: Location & Operator */}
            <Card className="rounded-xl">
              <CardHeader>
                <CardTitle className="text-base">Location &amp; Operator</CardTitle>
              </CardHeader>
              <CardContent className="grid sm:grid-cols-2 gap-x-6 gap-y-4">
                {/* Customer — read-only display */}
                <Field
                  label="Customer"
                  value={visit.customerName}
                  editing={editing}
                />

                {/* District — read-only display */}
                <Field
                  label="District"
                  value={visit.districtName}
                  editing={editing}
                />

                <Field
                  label="Operating Company"
                  value={visit.operating_company}
                  editing={editing}
                >
                  <Input
                    value={form.operating_company}
                    onChange={(e) =>
                      setField('operating_company', e.target.value)
                    }
                    className="text-sm"
                  />
                </Field>

                <Field
                  label="Pad Name"
                  value={visit.pad_name}
                  editing={editing}
                >
                  <Input
                    value={form.pad_name}
                    onChange={(e) => setField('pad_name', e.target.value)}
                    className="text-sm"
                  />
                </Field>

                <Field
                  label="Coordinates (Lat/Long)"
                  value={visit.lat_long}
                  editing={editing}
                >
                  <Input
                    value={form.lat_long}
                    onChange={(e) => setField('lat_long', e.target.value)}
                    placeholder="e.g. 40.7128, -74.0060"
                    className="text-sm"
                  />
                </Field>
              </CardContent>
            </Card>

            {/* Section: Equipment */}
            <Card className="rounded-xl">
              <CardHeader>
                <CardTitle className="text-base">Equipment</CardTitle>
              </CardHeader>
              <CardContent className="grid sm:grid-cols-2 gap-x-6 gap-y-4">
                <Field
                  label="Communication Panel"
                  value={visit.communication_panel}
                  editing={editing}
                >
                  <Input
                    value={form.communication_panel}
                    onChange={(e) =>
                      setField('communication_panel', e.target.value)
                    }
                    className="text-sm"
                  />
                </Field>

                <Field
                  label="Digital Shooting Panel"
                  value={visit.digital_shooting_panel}
                  editing={editing}
                >
                  <Input
                    value={form.digital_shooting_panel}
                    onChange={(e) =>
                      setField('digital_shooting_panel', e.target.value)
                    }
                    className="text-sm"
                  />
                </Field>

                <Field
                  label="Surface Tester"
                  value={visit.surface_tester}
                  editing={editing}
                >
                  <Input
                    value={form.surface_tester}
                    onChange={(e) => setField('surface_tester', e.target.value)}
                    className="text-sm"
                  />
                </Field>
              </CardContent>
            </Card>

            {/* Section: Visit Summary */}
            <Card className="rounded-xl">
              <CardHeader>
                <CardTitle className="text-base">Visit Summary</CardTitle>
              </CardHeader>
              <CardContent>
                {editing ? (
                  <Textarea
                    value={form.visit_summary}
                    onChange={(e) => setField('visit_summary', e.target.value)}
                    rows={6}
                    className="text-sm"
                  />
                ) : (
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <pre className="whitespace-pre-wrap text-sm text-gray-900 font-sans">
                      {visit.visit_summary || 'No summary provided'}
                    </pre>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ── Right sidebar (1/3) ────────────────────────────────────── */}
          <div className="space-y-6">

            {/* Metadata card */}
            <Card className="rounded-xl">
              <CardHeader>
                <CardTitle className="text-base">Record Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Field
                  label="Field Visit ID"
                  value={visit.field_visit_id}
                  editing={false}
                />
                <Field
                  label="Customer"
                  value={visit.customerName}
                  editing={false}
                />
                <Field
                  label="District"
                  value={visit.districtName}
                  editing={false}
                />
              </CardContent>
            </Card>

            {/* Related Incidents card */}
            <Card className="rounded-xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <AlertTriangle className="w-4 h-4 text-gray-500" />
                  Related Incidents
                  {relatedIncidents.length > 0 && (
                    <Badge variant="secondary" className="ml-1">
                      {relatedIncidents.length}
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {relatedIncidents.length === 0 ? (
                  <p className="text-sm text-gray-400 italic">
                    No incidents linked to this field visit.
                  </p>
                ) : (
                  <ul className="divide-y divide-gray-100">
                    {relatedIncidents.map((inc) => (
                      <li key={inc.row_id}>
                        <button
                          type="button"
                          onClick={() => navigate(`/incidents/${inc.row_id}`)}
                          className="w-full text-left py-3 px-2 hover:bg-gray-50 rounded transition-colors group"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium text-gray-900 group-hover:text-blue-600 text-sm">
                                  Incident #{inc.event_id || inc.row_id.slice(0, 8)}
                                </span>
                                {inc.incident_status && (
                                  <Badge variant="outline" className="text-xs">
                                    {inc.incident_status}
                                  </Badge>
                                )}
                                {inc.incident_severity && (
                                  <Badge variant="outline" className="text-xs">
                                    {inc.incident_severity}
                                  </Badge>
                                )}
                              </div>
                              {inc.date_incident && (
                                <p className="text-xs text-gray-500 mt-0.5">
                                  {new Date(
                                    inc.date_incident + 'T12:00:00'
                                  ).toLocaleDateString()}
                                </p>
                              )}
                              {inc.incident_description && (
                                <p className="text-xs text-gray-600 mt-1 line-clamp-2">
                                  {inc.incident_description}
                                </p>
                              )}
                            </div>
                            <ExternalLink className="w-4 h-4 text-gray-300 group-hover:text-blue-500 flex-shrink-0 mt-0.5" />
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
