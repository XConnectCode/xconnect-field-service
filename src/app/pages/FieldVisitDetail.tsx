import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useAuth } from '../lib/auth-context';
import { detailApi, fieldVisitApi, hardwareInspectionApi } from '../lib/api';
import { supabase } from '../lib/supabase';
import { getSerial } from '../lib/serialUtils';
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
  CheckCircle2,
  FilePlus,
  GraduationCap,
  FileDown,
  Wrench,
} from 'lucide-react';
import { toast } from 'sonner';
import { listSessionsForVisit, type ChecklistSession } from '../lib/trainingChecklists';
import { generateTrainingVisitReportPDF } from '../lib/generateTrainingVisitReportPDF';
import { displayVisitDuration, toInputValue, formatVisitTimestamp } from '../lib/visitDuration';

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

const COMPLETE_STATUS = 'Complete';
const isComplete = (v: any) => (v.visit_status || '').toLowerCase() === 'complete';

// Panel types whose serials populate the equipment selects (FieldVisitForm parity).
const DIGITAL_SHOOTING_PANEL = 'Digital Shooting Panel';
const COMMUNICATION_PANEL = 'Communication Panel';
const SURFACE_TESTER = 'Surface Tester';

// ── Field helper ──────────────────────────────────────────────────────────────
interface FieldProps {
  label: string;
  value: string | null | undefined;
  editing: boolean;
  children?: React.ReactNode; // edit-mode input; omit to make read-only
  readOnlyHint?: string;      // shown under a read-only field while editing
}

function Field({ label, value, editing, children, readOnlyHint }: FieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
        {label}
      </span>
      {editing && children ? (
        children
      ) : editing ? (
        // Read-only field in edit mode: render a disabled-looking box so it is
        // visually obvious the value can't be typed (it is auto-calculated).
        <>
          <div className="text-sm text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 border border-dashed border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 cursor-not-allowed select-none">
            {value || '—'}
          </div>
          {readOnlyHint && (
            <span className="text-xs text-gray-400">{readOnlyHint}</span>
          )}
        </>
      ) : (
        <p className="text-sm text-gray-900 dark:text-gray-100">{value || '—'}</p>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function FieldVisitDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { accessToken, user } = useAuth();

  const [visit, setVisit] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [relatedIncidents, setRelatedIncidents] = useState<any[]>([]);
  const [trainingSessions, setTrainingSessions] = useState<ChecklistSession[]>([]);
  const [reportSessionId, setReportSessionId] = useState<string | null>(null);
  const [hwInspection, setHwInspection] = useState<any>(null);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [form, setForm] = useState<any>({});

  // Reference data (same sources as FieldVisitForm) for FK / enum selects.
  const [customers,   setCustomers]   = useState<any[]>([]);
  const [districts,   setDistricts]   = useState<any[]>([]);
  const [sqmReps,     setSqmReps]     = useState<string[]>([]);
  const [epCompanies, setEpCompanies] = useState<string[]>([]);
  const [allPanels,   setAllPanels]   = useState<any[]>([]);

  // ── data loading ────────────────────────────────────────────────────────────
  useEffect(() => {
    loadVisit();
  }, [id]);

  // Load customers / SQM reps / operating companies / panels once authenticated
  // (mirrors FieldVisitForm). Filter out the 'Pre-Tracking' SQM placeholder.
  useEffect(() => {
    if (!accessToken) return;
    Promise.all([
      supabase.from('customers').select('row_id,customer').order('customer'),
      supabase.from('sqm').select('sq_manager').order('sq_manager'),
      supabase.from('ep').select('operating_company').order('operating_company'),
      supabase.from('panels').select('serial_number,panel_type').order('serial_number'),
    ]).then(([c, s, e, p]) => {
      setCustomers(c.data || []);
      setSqmReps((s.data || []).map((r: any) => r.sq_manager).filter((r: string) => r && r !== 'Pre-Tracking'));
      setEpCompanies((e.data || []).map((r: any) => r.operating_company).filter(Boolean));
      setAllPanels(p.data || []);
    });
  }, [accessToken]);

  // Cascade districts off the selected customer (form.customer while editing,
  // else the visit's stored customer). Mirrors FieldVisitForm.
  useEffect(() => {
    const custId = editing ? form.customer : visit?.customer;
    if (!custId) { setDistricts([]); return; }
    supabase.from('districts').select('row_id,customer_district').eq('customer', custId).order('customer_district')
      .then(({ data }) => setDistricts(data || []));
  }, [editing, form.customer, visit?.customer]);

  // Panel options filtered by type (FieldVisitForm.panelsByType parity).
  const panelsByType = (type: string) => allPanels.filter((p) => p.panel_type === type);

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

        // Load any training checklist sessions linked to this visit.
        try {
          setTrainingSessions(await listSessionsForVisit(data.field_visit_id));
        } catch (e) {
          console.error('Error loading linked training sessions:', e);
          setTrainingSessions([]);
        }

        // Load any hardware inspection linked to this visit.
        try {
          setHwInspection(
            await hardwareInspectionApi.getByVisit(String(data.field_visit_id), accessToken ?? undefined)
          );
        } catch (e) {
          console.error('Error loading hardware inspection:', e);
          setHwInspection(null);
        }
      } else {
        setRelatedIncidents([]);
        setTrainingSessions([]);
        setHwInspection(null);
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
      customer: visit.customer ?? '',
      customer_district: visit.customer_district ?? '',
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

  // Changing the customer resets the district (it belongs to the old customer).
  // Mirrors the cascade reset in FieldVisitForm.
  function handleCustomerChange(v: string) {
    setForm((prev: any) => ({ ...prev, customer: v, customer_district: '' }));
  }

  function cancelEdit() {
    setEditing(false);
    setForm({});
  }

  function setField(name: string, value: string) {
    setForm((prev: any) => ({ ...prev, [name]: value }));
  }

  // Validate edit-mode inputs before saving. Returns an error string or null.
  function validateVisit(f: any): string | null {
    // Visit duration is auto-computed from arrival/departure, not user-entered,
    // so it is not validated here.
    // Departure can't be in the future.
    if (f.departure_date) {
      const dep = new Date(f.departure_date);
      if (!Number.isNaN(dep.getTime()) && dep.getTime() > Date.now()) {
        return 'Departure date cannot be in the future.';
      }
    }
    // Departure shouldn't precede arrival, when both are set.
    if (f.arrival_date && f.departure_date) {
      const arr = new Date(f.arrival_date);
      const dep = new Date(f.departure_date);
      if (!Number.isNaN(arr.getTime()) && !Number.isNaN(dep.getTime()) && dep < arr) {
        return 'Departure date cannot be before the arrival date.';
      }
    }
    return null;
  }

  async function handleSave() {
    if (!id || !accessToken) return;
    const validationError = validateVisit(form);
    if (validationError) {
      toast.error(validationError);
      return;
    }
    setSaving(true);
    try {
      const payload = {
        visit_purpose: form.visit_purpose || null,
        field_or_facility: form.field_or_facility || null,
        // Persist the datetime-local strings verbatim (naive wall-clock), matching
        // the Edit modal. No UTC conversion — that would shift the stored time.
        arrival_date: form.arrival_date || null,
        departure_date: form.departure_date || null,
        // visit_duration is derived from arrival/departure and is not persisted
        // from the form (it would otherwise drift out of sync with the dates).
        customer: form.customer || null,
        customer_district: form.customer_district || null,
        customer_rep: form.customer_rep || null,
        xc_rep: form.xc_rep || null,
        operating_company: form.operating_company || null,
        pad_name: form.pad_name || null,
        lat_long: form.lat_long || null,
        communication_panel: form.communication_panel || null,
        digital_shooting_panel: form.digital_shooting_panel || null,
        surface_tester: form.surface_tester || null,
        visit_summary: form.visit_summary || null,
        // Always stamp the saving user + today's date on edit (form parity).
        updated_by: user?.name || user?.email || null,
        date_updated: new Date().toLocaleDateString(),
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

  // ── Mark Visit Complete ──────────────────────────────────────────────────────
  // Primary action: flag the visit as done. Stamps status + who/when. Sending
  // only the completion fields (others undefined) leaves the rest untouched.
  async function handleMarkComplete() {
    if (!id || !accessToken || !visit) return;
    const who = user?.name || user?.email || null;
    setCompleting(true);
    try {
      await fieldVisitApi.update(
        id,
        {
          visit_status: COMPLETE_STATUS,
          completed_at: new Date().toISOString(),
          completed_by: who,
          updated_by: who,
          date_updated: new Date().toLocaleDateString(),
        },
        accessToken,
      );
      toast.success('Field visit marked complete');
      await loadVisit();
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to mark visit complete');
    } finally {
      setCompleting(false);
    }
  }

  // Reopen a completed visit (clears the completion stamps).
  async function handleReopen() {
    if (!id || !accessToken || !visit) return;
    const who = user?.name || user?.email || null;
    setCompleting(true);
    try {
      await fieldVisitApi.update(
        id,
        {
          visit_status: null,
          completed_at: null,
          completed_by: null,
          updated_by: who,
          date_updated: new Date().toLocaleDateString(),
        },
        accessToken,
      );
      toast.success('Field visit reopened');
      await loadVisit();
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to reopen visit');
    } finally {
      setCompleting(false);
    }
  }

  // ── Log an Incident from this visit ──────────────────────────────────────────
  // Opens the new-incident flow pre-linked to this field visit (and carries the
  // customer/district names through for the header context).
  function handleLogIncident() {
    if (!visit) return;
    const params = new URLSearchParams({ new: '1' });
    if (visit.field_visit_id) params.set('fieldVisitId', visit.field_visit_id);
    if (visit.customer) params.set('customerId', visit.customer);
    if (visit.customer_district) params.set('districtId', visit.customer_district);
    if (visit.customerName) params.set('customerName', visit.customerName);
    navigate(`/incidents?${params.toString()}`);
  }

  // ── Download a combined Field Visit + Training Checklist customer report ─────
  async function handleDownloadTrainingReport(session: ChecklistSession) {
    setReportSessionId(session.id);
    try {
      await generateTrainingVisitReportPDF({ visit, session });
    } catch (err: any) {
      toast.error(err?.message || 'Failed to generate report');
    }
    setReportSessionId(null);
  }

  // ── Attach a Training Checklist from this visit ──────────────────────────────
  // Opens the Training Checklists flow pre-linked to this field visit so an SQM
  // can pick a template and start a session tied to the visit.
  function handleAttachTraining() {
    if (!visit) return;
    const params = new URLSearchParams({ start: '1' });
    if (visit.field_visit_id) params.set('fieldVisitId', visit.field_visit_id);
    if (visit.customerName) params.set('customer', visit.customerName);
    else if (visit.customer) params.set('customer', visit.customer);
    navigate(`/training-checklists?${params.toString()}`);
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
    // Render the stored wall-clock verbatim (no time-zone conversion) so the
    // detail view matches the Edit modal, which treats timestamps as naive.
    return formatVisitTimestamp(val);
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
            className="mb-4 -ml-1 text-gray-600 dark:text-gray-300 hover:text-gray-900"
          >
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back to Field Visits
          </Button>

          {/* Title row */}
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            {/* Left: title block */}
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 leading-tight">
                Field Visit
              </h1>
              <p className="text-gray-500 mt-0.5 text-sm">
                {visit.field_visit_id || 'N/A'} &mdash;{' '}
                {visit.customerName || 'Unknown Customer'}
              </p>
            </div>

            {/* Right: badge + actions */}
            <div className="flex flex-wrap items-center gap-3 flex-shrink-0">
              {visit.visit_purpose && (
                <Badge variant="secondary">{visit.visit_purpose}</Badge>
              )}
              {isComplete(visit) && (
                <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Complete
                </Badge>
              )}
              {!editing ? (
                <>
                  {/* Primary action: log an incident pre-linked to this visit. */}
                  <Button
                    variant="outline"
                    onClick={handleLogIncident}
                    className="gap-1.5"
                  >
                    <FilePlus className="w-4 h-4" />
                    Log Incident
                  </Button>

                  {/* Attach a training checklist (shown for Training-purpose visits). */}
                  {visit.visit_purpose === 'Training' && (
                    <Button
                      variant="outline"
                      onClick={handleAttachTraining}
                      className="gap-1.5"
                    >
                      <GraduationCap className="w-4 h-4" />
                      Attach Training Checklist
                    </Button>
                  )}

                  {/* Primary action: mark complete / reopen. */}
                  {isComplete(visit) ? (
                    <Button
                      variant="outline"
                      onClick={handleReopen}
                      disabled={completing}
                      className="gap-1.5 text-amber-700 border-amber-200 hover:bg-amber-50"
                    >
                      {completing ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <X className="w-4 h-4" />
                      )}
                      Reopen Visit
                    </Button>
                  ) : (
                    <Button
                      onClick={handleMarkComplete}
                      disabled={completing}
                      className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                    >
                      {completing ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4" />
                      )}
                      Mark Complete
                    </Button>
                  )}

                  <Button size="sm" variant="ghost" onClick={enterEdit}>
                    <Pencil className="w-3.5 h-3.5 mr-1.5" />
                    Edit
                  </Button>
                </>
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
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-md p-2 text-sm"
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
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-md p-2 text-sm"
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
                    value={toInputValue(form.arrival_date)}
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
                    value={toInputValue(form.departure_date)}
                    onChange={(e) => setField('departure_date', e.target.value)}
                    className="text-sm"
                  />
                </Field>

                {/* Visit Duration is auto-computed from arrival → departure and
                    is read-only. In edit mode it updates live from the form's
                    date fields; otherwise it reflects the saved visit. */}
                <Field
                  label="Visit Duration"
                  value={
                    editing
                      ? displayVisitDuration({
                          arrival_date: form.arrival_date,
                          departure_date: form.departure_date,
                          visit_duration: visit.visit_duration,
                        })
                      : displayVisitDuration(visit)
                  }
                  editing={editing}
                  readOnlyHint="Auto-calculated from arrival → departure"
                />

                {/* XC Rep — constrained SQM dropdown (FieldVisitForm parity). */}
                <Field
                  label="XC Representative"
                  value={visit.xc_rep}
                  editing={editing}
                >
                  <select
                    value={form.xc_rep ?? ''}
                    onChange={(e) => setField('xc_rep', e.target.value)}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-md p-2 text-sm"
                  >
                    <option value="">— Select —</option>
                    {sqmReps.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
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
                {/* Customer — editable FK select with district cascade (form parity). */}
                <Field
                  label="Customer"
                  value={visit.customerName}
                  editing={editing}
                >
                  <select
                    value={form.customer ?? ''}
                    onChange={(e) => handleCustomerChange(e.target.value)}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-md p-2 text-sm"
                  >
                    <option value="">— Select customer —</option>
                    {customers.map((c) => (
                      <option key={c.row_id} value={c.row_id}>{c.customer}</option>
                    ))}
                  </select>
                </Field>

                {/* District — FK select cascading off the selected customer. */}
                <Field
                  label="District"
                  value={visit.districtName}
                  editing={editing}
                >
                  <select
                    value={form.customer_district ?? ''}
                    onChange={(e) => setField('customer_district', e.target.value)}
                    disabled={!form.customer}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-md p-2 text-sm"
                  >
                    <option value="">— Select district —</option>
                    {districts.map((d) => (
                      <option key={d.row_id} value={d.row_id}>{d.customer_district}</option>
                    ))}
                  </select>
                </Field>

                {/* Operating Company — constrained ep dropdown (form parity). */}
                <Field
                  label="Operating Company"
                  value={visit.operating_company}
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
                {/* Communication Panel — serials filtered by panel_type (form parity). */}
                <Field
                  label="Communication Panel"
                  value={visit.communication_panel}
                  editing={editing}
                >
                  <select
                    value={form.communication_panel ?? ''}
                    onChange={(e) => setField('communication_panel', e.target.value)}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-md p-2 text-sm"
                  >
                    <option value="">— None —</option>
                    {panelsByType(COMMUNICATION_PANEL).map((p) => (
                      <option key={getSerial(p)} value={getSerial(p)}>{getSerial(p)}</option>
                    ))}
                  </select>
                </Field>

                {/* Digital Shooting Panel — serials filtered by panel_type (form parity). */}
                <Field
                  label="Digital Shooting Panel"
                  value={visit.digital_shooting_panel}
                  editing={editing}
                >
                  <select
                    value={form.digital_shooting_panel ?? ''}
                    onChange={(e) => setField('digital_shooting_panel', e.target.value)}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-md p-2 text-sm"
                  >
                    <option value="">— None —</option>
                    {panelsByType(DIGITAL_SHOOTING_PANEL).map((p) => (
                      <option key={getSerial(p)} value={getSerial(p)}>{getSerial(p)}</option>
                    ))}
                  </select>
                </Field>

                {/* Surface Tester — serials filtered by panel_type (form parity). */}
                <Field
                  label="Surface Tester"
                  value={visit.surface_tester}
                  editing={editing}
                >
                  <select
                    value={form.surface_tester ?? ''}
                    onChange={(e) => setField('surface_tester', e.target.value)}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-md p-2 text-sm"
                  >
                    <option value="">— None —</option>
                    {panelsByType(SURFACE_TESTER).map((p) => (
                      <option key={getSerial(p)} value={getSerial(p)}>{getSerial(p)}</option>
                    ))}
                  </select>
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
                  <div className="bg-gray-50 dark:bg-gray-800/50 p-4 rounded-lg">
                    <pre className="whitespace-pre-wrap text-sm text-gray-900 dark:text-gray-100 font-sans">
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
                <Field
                  label="Status"
                  value={isComplete(visit) ? 'Complete' : 'Open'}
                  editing={false}
                />
                {isComplete(visit) && (
                  <>
                    <Field
                      label="Completed By"
                      value={visit.completed_by}
                      editing={false}
                    />
                    <Field
                      label="Completed At"
                      value={visit.completed_at ? fmtDate(visit.completed_at) : '—'}
                      editing={false}
                    />
                  </>
                )}
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
                                <span className="font-medium text-gray-900 dark:text-gray-100 group-hover:text-blue-600 text-sm">
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
                                <p className="text-xs text-gray-600 dark:text-gray-300 mt-1 line-clamp-2">
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

            {/* Linked Training Checklists card */}
            <Card className="rounded-xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <GraduationCap className="w-4 h-4 text-gray-500" />
                  Training Checklists
                  {trainingSessions.length > 0 && (
                    <Badge variant="secondary" className="ml-1">
                      {trainingSessions.length}
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {trainingSessions.length === 0 ? (
                  <p className="text-sm text-gray-400 italic">
                    No training checklist linked to this field visit.
                  </p>
                ) : (
                  <ul className="divide-y divide-gray-100">
                    {trainingSessions.map((s) => (
                      <li key={s.id} className="flex items-start gap-2 py-1">
                        <button
                          type="button"
                          onClick={() => navigate(`/training-checklists/session/${s.id}`)}
                          className="flex-1 min-w-0 text-left py-2 px-2 hover:bg-gray-50 rounded transition-colors group"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium text-gray-900 dark:text-gray-100 group-hover:text-blue-600 text-sm">
                                  {s.template_name || 'Training Checklist'}
                                </span>
                                {s.status && (
                                  <Badge variant="outline" className="text-xs">
                                    {s.status === 'completed' ? 'Completed' : 'In progress'}
                                  </Badge>
                                )}
                                {s.product_line && (
                                  <Badge variant="outline" className="text-xs">
                                    {s.product_line}
                                  </Badge>
                                )}
                              </div>
                              <p className="text-xs text-gray-500 mt-0.5">
                                {[
                                  s.customer || null,
                                  s.trainer_name ? `SQM: ${s.trainer_name}` : null,
                                  s.training_date ? new Date(s.training_date + 'T12:00:00').toLocaleDateString() : null,
                                ].filter(Boolean).join(' · ')}
                              </p>
                            </div>
                            <ExternalLink className="w-4 h-4 text-gray-300 group-hover:text-blue-500 flex-shrink-0 mt-0.5" />
                          </div>
                        </button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="mt-1 flex-shrink-0 gap-1.5"
                          disabled={reportSessionId === s.id}
                          onClick={() => handleDownloadTrainingReport(s)}
                          title="Download combined field visit + training report"
                        >
                          <FileDown className="w-3.5 h-3.5" />
                          {reportSessionId === s.id ? 'Generating…' : 'Report'}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            {/* Hardware Inspection card */}
            <Card className="rounded-xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Wrench className="w-4 h-4 text-gray-500" />
                  Hardware Inspection
                  {hwInspection?.row_id && (hwInspection.items?.length || 0) > 0 && hwInspection.overall_status && (
                    <Badge
                      variant="outline"
                      className={
                        hwInspection.overall_status === 'pass'
                          ? 'bg-green-100 text-green-800 border-green-200'
                          : hwInspection.overall_status === 'monitor'
                          ? 'bg-yellow-100 text-yellow-800 border-yellow-200'
                          : hwInspection.overall_status === 'replace_soon'
                          ? 'bg-orange-100 text-orange-800 border-orange-200'
                          : 'bg-red-100 text-red-800 border-red-200'
                      }
                    >
                      {hwInspection.overall_status === 'pass' ? 'Pass'
                        : hwInspection.overall_status === 'monitor' ? 'Monitor'
                        : hwInspection.overall_status === 'replace_soon' ? 'Replace soon'
                        : 'Remove from service'}
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {hwInspection?.row_id && (hwInspection.items?.length || 0) > 0 ? (
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    {(hwInspection.items?.length || 0)} component{(hwInspection.items?.length || 0) === 1 ? '' : 's'} checked
                    {hwInspection.inspection_date
                      ? ` · ${new Date(hwInspection.inspection_date).toLocaleDateString()}`
                      : ''}
                    {hwInspection.inspector ? ` · ${hwInspection.inspector}` : ''}
                  </p>
                ) : (
                  <p className="text-sm text-gray-400 italic">
                    No hardware inspection recorded for this visit.
                  </p>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => navigate(`/field-visits/${visit.field_visit_id}/hardware-inspection`)}
                >
                  <Wrench className="w-4 h-4" />
                  {hwInspection?.row_id && (hwInspection.items?.length || 0) > 0 ? 'View / edit inspection' : 'Start hardware inspection'}
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
