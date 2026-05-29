/**
 * IncidentForm.tsx
 * Full create/edit dialog for the incidents table.
 * Schema-synced with live Supabase incidents table.
 *
 * Layout: grouped section cards in workflow order
 *   1. General Info       2. Customer/Location    3. Personnel
 *   4. Job Details        5. Classification        6. Investigation
 *   7. Corrective/Preventive  8. Closure  9. Evidence  10. Notes
 *
 * Evidence images use the polymorphic ImageUpload component (drag/drop + browse)
 * backed by the Edge Function (`/images/incidents/:row_id`) — the same path the
 * incident detail page uses. The legacy `image1` / `image2` columns are still
 * preserved for already-saved rows and continue to surface in PDF picker fallbacks.
 */

import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { toast } from 'sonner';
import { Info } from 'lucide-react';
import {
  normalizeStatus,
  validateForStatus,
  statusOptionsForRole,
  canSetStatus,
} from '../../lib/incidentWorkflow';
import ImageUpload from '../../components/ImageUpload';
import { projectId, publicAnonKey } from '../../../../utils/supabase/info';

// ── Helpers ───────────────────────────────────────────────────────────────────

function F({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label className="text-xs font-semibold text-gray-600 mb-1 block">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </Label>
      {children}
    </div>
  );
}

/**
 * Section card — replaces the previous flat <Section /> divider so that each
 * group of fields is visually scoped, easier to scan, and gives the modal a
 * workflow-oriented feel without converting it into a full multi-step wizard.
 */
function SectionCard({
  title,
  description,
  children,
  cols = 2,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  cols?: 1 | 2 | 3;
}) {
  const colClass =
    cols === 1 ? 'grid-cols-1' : cols === 3 ? 'md:grid-cols-3' : 'md:grid-cols-2';
  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <header className="px-4 pt-3 pb-2 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
        {description && (
          <p className="text-xs text-gray-500 mt-0.5">{description}</p>
        )}
      </header>
      <div className={`grid grid-cols-1 ${colClass} gap-x-6 gap-y-4 p-4`}>
        {children}
      </div>
    </section>
  );
}

/**
 * Extract distinct, sorted option strings from lists table rows.
 */
function opts(listItems: any[], col: string): string[] {
  return Array.from(
    new Set(
      listItems
        .map((i: any) => i[col] as string | null)
        .filter((v): v is string => !!v)
    )
  ).sort();
}

function Sel({
  name,
  defaultValue,
  children,
}: {
  name: string;
  defaultValue?: string;
  children: React.ReactNode;
}) {
  return (
    <select
      name={name}
      defaultValue={defaultValue || ''}
      className="w-full border border-gray-300 rounded-md p-2 text-sm"
    >
      {children}
    </select>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  incident?: any;
  currentUser?: any;
}

export default function IncidentForm({
  open,
  onClose,
  onSaved,
  incident,
  currentUser,
}: Props) {
  const editing = !!incident;

  // Reference data
  const [customers, setCustomers] = useState<any[]>([]);
  const [districts, setDistricts] = useState<any[]>([]);
  const [sqmReps, setSqmReps] = useState<string[]>([]);
  const [vendors, setVendors] = useState<any[]>([]);
  const [listItems, setListItems] = useState<any[]>([]);
  const [epCompanies, setEpCompanies] = useState<string[]>([]);
  const [fieldVisits, setFieldVisits] = useState<any[]>([]);
  const [components, setComponents] = useState<any[]>([]);

  // Form state
  const [custId, setCustId] = useState('');
  const [distId, setDistId] = useState('');
  const [saving, setSaving] = useState(false);
  const [nextEventId, setNextEventId] = useState<string>('');

  // ── Effects ─────────────────────────────────────────────────────────────────

  // Fetch next available Event ID — fetches ALL event_ids and finds the true numeric max.
  // We can't .order() because Supabase sorts event_id as text (e.g. "99" > "556"),
  // and we can't .limit() because that would miss higher IDs.
  useEffect(() => {
    if (!open || editing) return;

    supabase
      .from('incidents')
      .select('event_id')
      .then(({ data }) => {
        const maxId = (data || []).reduce((max, row: any) => {
          const n = parseInt(row.event_id);
          return !isNaN(n) && n > max ? n : max;
        }, 0);
        setNextEventId(String(maxId + 1));
      });
  }, [open, editing]);

  // Load reference tables once per open
  useEffect(() => {
    if (!open) return;

    Promise.all([
      supabase.from('customers').select('row_id,customer').order('customer'),
      supabase.from('sqm').select('sq_manager').order('sq_manager'),
      supabase.from('vendors').select('row_id,vendor').order('vendor'),
      supabase.from('lists').select('*'),
      supabase.from('ep').select('operating_company').order('operating_company'),
      supabase.from('components').select('row_id,failed_component,vendor').order('failed_component'),
    ]).then(([c, s, v, l, e, comp]) => {
      setCustomers(c.data || []);
      setSqmReps(
        (s.data || [])
          .map((r: any) => r.sq_manager as string)
          .filter((r: string) => r && r !== 'Pre-Tracking')
      );
      setVendors(v.data || []);
      setListItems(l.data || []);
      setEpCompanies((e.data || []).map((r: any) => r.operating_company as string));
      setComponents((comp.data || []).filter((r: any) => r.failed_component));
    });
  }, [open]);

  // Load districts when customer changes
  useEffect(() => {
    if (!custId) {
      setDistricts([]);
      setDistId('');
      return;
    }

    supabase
      .from('districts')
      .select('row_id,customer_district')
      .eq('customer', custId)
      .order('customer_district')
      .then(({ data }) => setDistricts(data || []));
  }, [custId]);

  // Load recent field visits when customer changes
  useEffect(() => {
    if (!custId) {
      setFieldVisits([]);
      return;
    }

    supabase
      .from('fieldvisits')
      .select('row_id, field_visit_id, arrival_date, pad_name')
      .eq('customer', custId)
      .order('arrival_date', { ascending: false })
      .limit(50)
      .then(({ data }) => setFieldVisits(data || []));
  }, [custId]);

  // Pre-fill when editing
  useEffect(() => {
    if (incident) {
      setCustId(incident.customer || '');
      setDistId(incident.customer_district || '');
    } else {
      setCustId('');
      setDistId('');
    }
  }, [incident, open]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const fd = new FormData(e.currentTarget);

    // ── Workflow validation: gate moves to Final Review / Closed ─────────────
    const targetStatus = String(fd.get('incident_status') || '');
    if (!canSetStatus(currentUser?.role, targetStatus)) {
      toast.error(`Only admins can set status to "${targetStatus}".`);
      return;
    }

    // Build a candidate record from form + existing values to validate against.
    const candidate: Record<string, any> = {
      ...(incident || {}),
      xc_caused:        fd.get('xc_caused') || incident?.xc_caused,
      vendor_caused:    fd.get('vendor_caused') || incident?.vendor_caused,
      vendor:           fd.get('vendor') || incident?.vendor,
      failed_component: fd.get('failed_component') || incident?.failed_component,
      event_category:   fd.get('event_category') || incident?.event_category,
      failure_type:     fd.get('failure_type') || incident?.failure_type,
      product_line:     fd.get('product_line') || incident?.product_line,
      root_cause:       fd.get('root_cause') || incident?.root_cause,
      // report_sent is not on the form — keep the existing value when validating
      report_sent:      incident?.report_sent,
    };
    const missing = validateForStatus(candidate, targetStatus);
    if (missing.length) {
      toast.error(
        `Cannot save with status "${targetStatus}" — missing required fields: ${missing.join(', ')}.`,
        { duration: 6000 },
      );
      return;
    }

    setSaving(true);

    const payload: Record<string, any> = {
      date_incident: fd.get('date_incident') || null,
      incident_status: fd.get('incident_status') || null,
      incident_severity: fd.get('incident_severity') || null,
      xc_caused: fd.get('xc_caused') || null,
      event_category: fd.get('event_category') || null,
      product_line: fd.get('product_line') || null,
      firing_system: fd.get('firing_system') || null,
      field_facility: fd.get('field_facility') || null,
      customer: custId || null,
      customer_district: distId || null,
      xc_rep: fd.get('xc_rep') || null,
      customer_rep: fd.get('customer_rep') || null,
      ep_rep: fd.get('ep_rep') || null,
      operating_company: fd.get('operating_company') || null,
      xc_district: fd.get('xc_district') || null,
      well_name: fd.get('well_name') || null,
      stage_number: fd.get('stage_number') || null,
      so_number: fd.get('so_number') || null,
      field_visit_id: fd.get('field_visit_id') || null,
      failed_component: fd.get('failed_component') || null,
      failure_type: fd.get('failure_type') || null,
      vendor: fd.get('vendor') || null,
      vendor_caused: fd.get('vendor_caused') || null,
      incident_description: fd.get('incident_description') || null,
      investigation: fd.get('investigation') || null,
      root_cause: fd.get('root_cause') || null,
      corrective_action: fd.get('corrective_action') || null,
      preventive_action: fd.get('preventive_action') || null,
      action_assigned_to: fd.get('action_assigned_to') || null,
      action_due_date: fd.get('action_due_date') || null,
      action_status: fd.get('action_status') || null,
      closed_date: fd.get('closed_date') || null,
      closed_by: fd.get('closed_by') || null,
      report_version: fd.get('report_version') || null,
      notes: fd.get('notes') || null,
    };

    if (!editing) {
      payload.event_id = fd.get('event_id') || '';
    }

    try {
      const { error } = editing
        ? await supabase
            .from('incidents')
            .update(payload)
            .eq('row_id', incident.row_id)
        : await supabase.from('incidents').insert(payload);

      if (error) throw new Error(error.message);

      toast.success(`Incident ${editing ? 'updated' : 'created'} successfully`);
      onSaved();
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save incident');
    } finally {
      setSaving(false);
    }
  };

  const uniqueFailureTypes = [
    ...new Map(
      listItems
        .filter((l: any) => l.failure_type)
        .map((l: any) => [l.failure_type, l] as const)
    ).values(),
  ];

  const edgeBaseUrl = `https://${projectId}.supabase.co/functions/v1/make-server-64775d98`;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-5 pb-3 border-b shrink-0">
          <DialogTitle>
            {editing
              ? `Edit Incident #${incident.event_id}`
              : 'Report New Incident'}
          </DialogTitle>
        </DialogHeader>

        <form
          id="incident-form"
          onSubmit={handleSubmit}
          className="flex-1 overflow-y-auto px-6 py-5 space-y-5"
        >
          {/* 1. General Info */}
          <SectionCard title="General Info">
            {!editing && (
              <F label="Event ID" required>
                <Input
                  name="event_id"
                  required
                  value={nextEventId}
                  readOnly
                  className="font-mono bg-gray-50 cursor-not-allowed"
                  title="Auto-assigned. Cannot be edited."
                />
              </F>
            )}

            <F label="Incident Date" required>
              <Input
                name="date_incident"
                type="date"
                defaultValue={incident?.date_incident || ''}
                required
              />
            </F>

            <F label="Status">
              <Sel
                name="incident_status"
                defaultValue={normalizeStatus(incident?.incident_status) || 'New'}
              >
                <option value="">— Select —</option>
                {statusOptionsForRole(currentUser?.role).map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
                {/* Always allow keeping the current value, even if it's not in the
                    role-allowed list (e.g. Closed for SQMs viewing a closed record). */}
                {incident?.incident_status &&
                  !statusOptionsForRole(currentUser?.role).includes(normalizeStatus(incident.incident_status) as any) &&
                  normalizeStatus(incident.incident_status) && (
                    <option value={normalizeStatus(incident.incident_status) as string}>
                      {normalizeStatus(incident.incident_status)} (current)
                    </option>
                  )}
              </Sel>
            </F>

            <F label="Severity">
              <Sel
                name="incident_severity"
                defaultValue={incident?.incident_severity || ''}
              >
                <option value="">— Select —</option>
                {opts(listItems, 'incident_severity').map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Sel>
            </F>

            <F label="Report Version">
              <Sel
                name="report_version"
                defaultValue={incident?.report_version || 'Preliminary'}
              >
                <option value="">— Select —</option>
                {opts(listItems, 'report_version').map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Sel>
            </F>

            <F label="Field or Facility">
              <Sel
                name="field_facility"
                defaultValue={incident?.field_facility || 'Field'}
              >
                <option value="">— Select —</option>
                {opts(listItems, 'field_facility').map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Sel>
            </F>
          </SectionCard>

          {/* 2. Customer / Location */}
          <SectionCard title="Customer & Location">
            <F label="Customer" required>
              <select
                value={custId}
                onChange={(e) => {
                  setCustId(e.target.value);
                  setDistId('');
                }}
                className="w-full border border-gray-300 rounded-md p-2 text-sm"
                required
              >
                <option value="">— Select customer —</option>
                {customers.map((c: any) => (
                  <option key={c.row_id} value={c.row_id}>
                    {c.customer}
                  </option>
                ))}
              </select>
            </F>

            <F label="District">
              <select
                value={distId}
                onChange={(e) => setDistId(e.target.value)}
                disabled={!custId}
                className="w-full border border-gray-300 rounded-md p-2 text-sm"
              >
                <option value="">— All districts —</option>
                {districts.map((d: any) => (
                  <option key={d.row_id} value={d.row_id}>
                    {d.customer_district}
                  </option>
                ))}
              </select>
            </F>

            <F label="Operating Company">
              <Sel
                key={`op-${incident?.row_id}-${epCompanies.length}`}
                name="operating_company"
                defaultValue={incident?.operating_company || ''}
              >
                <option value="">— Select —</option>
                {epCompanies.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Sel>
            </F>
          </SectionCard>

          {/* 3. Personnel */}
          <SectionCard title="Personnel">
            <F label="XC Rep">
              <Sel
                key={`xcrep-${incident?.row_id}-${sqmReps.length}`}
                name="xc_rep"
                defaultValue={incident?.xc_rep || currentUser?.name || ''}
              >
                <option value="">— Select —</option>
                {sqmReps.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Sel>
            </F>

            <F label="XC District">
              <Input
                name="xc_district"
                defaultValue={incident?.xc_district || ''}
                placeholder="e.g. Permian Basin"
              />
            </F>

            <F label="Customer Rep">
              <Input name="customer_rep" defaultValue={incident?.customer_rep || ''} />
            </F>

            <F label="EP Rep">
              <Input name="ep_rep" defaultValue={incident?.ep_rep || ''} />
            </F>
          </SectionCard>

          {/* 4. Job Details */}
          <SectionCard title="Job Details">
            <F label="Well Name">
              <Input name="well_name" defaultValue={incident?.well_name || ''} />
            </F>

            <F label="Stage #">
              <Input
                name="stage_number"
                defaultValue={incident?.stage_number || ''}
              />
            </F>

            <F label="SO #">
              <Input name="so_number" defaultValue={incident?.so_number || ''} />
            </F>

            <F label="Field Visit">
              <Sel
                key={`fv-${incident?.row_id}-${fieldVisits.length}`}
                name="field_visit_id"
                defaultValue={incident?.field_visit_id || ''}
              >
                <option value="">— None / Not linked —</option>
                {/* Fallback: if editing an incident whose saved visit isn't in the latest-50 list,
                    still show it so the link isn't silently dropped on save. */}
                {incident?.field_visit_id &&
                  !fieldVisits.some((v: any) => v.field_visit_id === incident.field_visit_id) && (
                    <option value={incident.field_visit_id}>
                      {incident.field_visit_id} (previously linked)
                    </option>
                  )}
                {fieldVisits.map((v: any) => (
                  <option key={v.row_id} value={v.field_visit_id}>
                    {v.field_visit_id} — {v.pad_name || 'No pad'} (
                    {v.arrival_date?.slice(0, 10) || 'No date'})
                  </option>
                ))}
              </Sel>
            </F>
          </SectionCard>

          {/* 5. Classification */}
          <SectionCard title="Incident Classification">
            <F label="XC Caused">
              <Sel name="xc_caused" defaultValue={incident?.xc_caused || ''}>
                <option value="">— Select —</option>
                {opts(listItems, 'xc_caused').map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Sel>
            </F>

            <F label="Event Category">
              <Sel
                name="event_category"
                defaultValue={incident?.event_category || ''}
              >
                <option value="">— Select —</option>
                {opts(listItems, 'event_category').map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Sel>
            </F>

            <F label="Product Line">
              <Sel
                name="product_line"
                defaultValue={incident?.product_line || ''}
              >
                <option value="">— Select —</option>
                {opts(listItems, 'xc_products').map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Sel>
            </F>

            <F label="Firing System">
              <Sel
                name="firing_system"
                defaultValue={incident?.firing_system || ''}
              >
                <option value="">— Select —</option>
                {opts(listItems, 'firing_system').map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Sel>
            </F>

            <F label="Failed Component">
              <Sel
                key={`fc-${incident?.row_id}-${components.length}-${listItems.length}`}
                name="failed_component"
                defaultValue={incident?.failed_component || ''}
              >
                <option value="">— Select —</option>
                {components.map((c: any) => (
                  <option key={c.row_id} value={c.row_id}>
                    {c.failed_component}
                  </option>
                ))}
                {/* Legacy fallback: incidents created via AppSheet imports
                    stored a `lists.row_id` here. Surface those values too so
                    the previously-saved label still appears when editing. */}
                {listItems
                  .filter((l: any) => l.failed_component)
                  .filter(
                    (l: any) =>
                      !components.some((c: any) => c.row_id === l.row_id),
                  )
                  .map((l: any) => (
                    <option key={`legacy-${l.row_id}`} value={l.row_id}>
                      {l.failed_component} (legacy)
                    </option>
                  ))}
                {/* Last-resort: if the saved value isn't in either table
                    (orphan id), keep it so the save doesn't clobber the
                    field on unrelated edits. */}
                {incident?.failed_component &&
                  !components.some((c: any) => c.row_id === incident.failed_component) &&
                  !listItems.some((l: any) => l.row_id === incident.failed_component) && (
                    <option value={incident.failed_component}>
                      {incident.failed_component} (unknown)
                    </option>
                  )}
              </Sel>
            </F>

            <F label="Failure Type">
              <Sel
                key={`ft-${incident?.row_id}-${listItems.length}`}
                name="failure_type"
                defaultValue={incident?.failure_type || ''}
              >
                <option value="">— Select —</option>
                {uniqueFailureTypes.map((l: any) => (
                  <option key={l.row_id} value={l.row_id}>
                    {l.failure_type}
                  </option>
                ))}
              </Sel>
            </F>

            <F label="Vendor">
              <Sel
                key={`vnd-${incident?.row_id}-${vendors.length}`}
                name="vendor"
                defaultValue={incident?.vendor || ''}
              >
                <option value="">— Select —</option>
                {vendors.map((v: any) => (
                  <option key={v.row_id} value={v.row_id}>
                    {v.vendor}
                  </option>
                ))}
              </Sel>
            </F>

            <F label="Vendor Caused">
              <Sel
                name="vendor_caused"
                defaultValue={incident?.vendor_caused || ''}
              >
                <option value="">— Select —</option>
                {opts(listItems, 'vendor_caused').map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Sel>
            </F>
          </SectionCard>

          {/* 6. Investigation / Root Cause */}
          <SectionCard title="Investigation & Root Cause" cols={1}>
            <F label="Incident Description">
              <Textarea
                name="incident_description"
                rows={3}
                defaultValue={incident?.incident_description || ''}
                placeholder="What happened?"
              />
            </F>

            <F label="Investigation">
              <Textarea
                name="investigation"
                rows={3}
                defaultValue={incident?.investigation || ''}
                placeholder="What was found during investigation?"
              />
            </F>

            <F label="Root Cause">
              <Textarea
                name="root_cause"
                rows={3}
                defaultValue={incident?.root_cause || ''}
                placeholder="Root cause analysis"
              />
            </F>
          </SectionCard>

          {/* 7. Corrective / Preventive Actions */}
          <SectionCard
            title="Corrective & Preventive Actions"
            description="Required to move beyond Investigating status."
          >
            <div className="md:col-span-2">
              <F label="Corrective Action">
                <Textarea
                  name="corrective_action"
                  rows={3}
                  defaultValue={incident?.corrective_action || ''}
                  placeholder="Actions taken to correct the issue"
                />
              </F>
            </div>

            <div className="md:col-span-2">
              <F label="Preventive Action">
                <Textarea
                  name="preventive_action"
                  rows={3}
                  defaultValue={incident?.preventive_action || ''}
                  placeholder="Actions taken to prevent recurrence"
                />
              </F>
            </div>

            <F label="Action Assigned To">
              <Sel
                key={`aa-${incident?.row_id}-${sqmReps.length}`}
                name="action_assigned_to"
                defaultValue={incident?.action_assigned_to || ''}
              >
                <option value="">— Select —</option>
                {sqmReps.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Sel>
            </F>

            <F label="Action Due Date">
              <Input
                name="action_due_date"
                type="date"
                defaultValue={incident?.action_due_date || ''}
              />
            </F>

            <F label="Action Status">
              <Sel
                name="action_status"
                defaultValue={incident?.action_status || ''}
              >
                <option value="">— Select —</option>
                {opts(listItems, 'action_status').map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Sel>
            </F>
          </SectionCard>

          {/* 8. Closure */}
          <SectionCard title="Closure">
            <F label="Closed Date">
              <Input
                name="closed_date"
                type="date"
                defaultValue={incident?.closed_date || ''}
              />
            </F>

            <F label="Closed By">
              <Sel
                key={`cb-${incident?.row_id}-${sqmReps.length}`}
                name="closed_by"
                defaultValue={incident?.closed_by || ''}
              >
                <option value="">— Select —</option>
                {sqmReps.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Sel>
            </F>
          </SectionCard>

          {/* 9. Evidence Images — uses the same Edge-Function-backed uploader as
                the detail page. For new incidents the row_id doesn't exist yet,
                so we surface a hint to save first. */}
          <SectionCard
            title="Evidence Images"
            description="Drag and drop or browse — files are attached to this incident."
            cols={1}
          >
            {editing && incident?.row_id ? (
              <ImageUpload
                parentTable="incidents"
                parentRowId={incident.row_id}
                baseUrl={edgeBaseUrl}
                publicAnonKey={publicAnonKey}
                autoLoad
                maxImages={20}
              />
            ) : (
              <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                <Info className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  Save this incident first to enable evidence image uploads.
                  Once saved, reopen the incident (Edit or open the detail page)
                  to drag and drop photos.
                </div>
              </div>
            )}
          </SectionCard>

          {/* 10. Notes */}
          <SectionCard title="Notes" cols={1}>
            <F label="Notes">
              <Textarea name="notes" rows={2} defaultValue={incident?.notes || ''} />
            </F>
          </SectionCard>
        </form>

        {/* Sticky footer actions — always visible regardless of scroll */}
        <div className="flex justify-end gap-3 px-6 py-3 border-t bg-white shrink-0">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="incident-form" disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Update Incident' : 'Submit Incident'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
