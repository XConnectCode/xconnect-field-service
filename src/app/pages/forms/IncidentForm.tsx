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

import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { generateAndStoreIncidentSummary } from '../../lib/incidentSummary';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { toast } from 'sonner';
import { Info, Sparkles } from 'lucide-react';
import IncidentAIAssistant, { type IncidentSnapshot } from '../../components/IncidentAIAssistant';
import type { AssistantField } from '../../lib/aiAssistantCore';
import {
  resolveFailedComponentLabel,
  resolveFailureTypeLabel,
} from '../../lib/failedComponent';
import {
  normalizeStatus,
  normalizeActionStatus,
  validateForStatus,
  statusOptionsForRole,
  canSetStatus,
  ACTION_STATUSES,
  ACTION_STATUS_LABELS,
  ACTION_STATUS_COMPLETE,
  CLOSED_STATUS,
} from '../../lib/incidentWorkflow';
import ImageUpload from '../../components/ImageUpload';
import { projectId, publicAnonKey } from '../../../../utils/supabase/info';
import { XC_BASES } from '../../lib/xcLocations';

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
      <Label className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1 block">
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
    <section className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
      <header className="px-4 pt-3 pb-2 border-b border-gray-100 dark:border-gray-700">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">{title}</h3>
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
 * Textarea field with an inline "AI" trigger that opens the assistant panel
 * preselected to this field. Uses a ref so the assistant can read the
 * current value and write accepted suggestions back without converting the
 * surrounding form away from its uncontrolled FormData submit pattern.
 */
function AssistField({
  field,
  label,
  refObj,
  defaultValue,
  placeholder,
  rows = 3,
  onAiOpen,
}: {
  field: AssistantField;
  label: string;
  refObj: React.RefObject<HTMLTextAreaElement>;
  defaultValue: string;
  placeholder?: string;
  rows?: number;
  onAiOpen: (f: AssistantField) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <Label className="text-xs font-semibold text-gray-600 dark:text-gray-300">{label}</Label>
        <button
          type="button"
          onClick={() => onAiOpen(field)}
          className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 hover:bg-indigo-100"
          title={`Open AI assistant for ${label}`}
        >
          <Sparkles className="h-3 w-3" />
          AI
        </button>
      </div>
      {/* Native textarea so we can attach a ref. Styled to match the
          shared <Textarea /> component used elsewhere in this form. */}
      <textarea
        ref={refObj}
        name={field}
        rows={rows}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="resize-none border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 flex field-sizing-content min-h-16 w-full rounded-md border bg-input-background px-3 py-2 text-base transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
      />
    </div>
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
  value,
  onChange,
  disabled,
  required,
  children,
}: {
  name: string;
  defaultValue?: string;
  value?: string;
  onChange?: (v: string) => void;
  disabled?: boolean;
  required?: boolean;
  children: React.ReactNode;
}) {
  // Controlled when `value`/`onChange` are supplied; otherwise uncontrolled
  // (FormData). `required` adds a subtle amber ring as a visual cue.
  const controlled = value !== undefined;
  return (
    <select
      name={name}
      {...(controlled
        ? { value, onChange: (e) => onChange?.(e.target.value) }
        : { defaultValue: defaultValue || '' })}
      disabled={disabled}
      className={`w-full border rounded-md p-2 text-sm disabled:opacity-50 disabled:bg-gray-100 dark:disabled:bg-gray-800 ${
        required
          ? 'border-amber-400 ring-1 ring-amber-200'
          : 'border-gray-300 dark:border-gray-600'
      }`}
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
  // Initial values for a NEW incident (e.g. "Log Incident" from a Field Visit).
  // Unlike `incident`, this does NOT switch the form into edit mode — the record
  // is still inserted, just with these fields pre-selected.
  prefill?: {
    field_visit_id?: string;
    customer?: string;
    customer_district?: string;
    qc_pallet_id?: string;
    qc_build_no?: string;
    so_number?: string;
  } | null;
  currentUser?: any;
}

export default function IncidentForm({
  open,
  onClose,
  onSaved,
  incident,
  prefill,
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
  const [qcPallets, setQcPallets] = useState<any[]>([]);
  const [components, setComponents] = useState<any[]>([]);

  // Form state
  const [custId, setCustId] = useState('');
  const [distId, setDistId] = useState('');
  const [saving, setSaving] = useState(false);
  const [nextEventId, setNextEventId] = useState<string>('');
  // Controlled so we can drive conditional requirements:
  //  - Vendor is only relevant when Vendor Caused === "Yes"
  //  - Failed Component is required for certain failure types (see below)
  const [vendorCaused, setVendorCaused] = useState('');
  const [failureType, setFailureType] = useState(''); // stores the lists row_id

  // Director Review (admin-only). Controlled so the admin can set/clear the
  // review sign-off inline; SQM sees a read-only badge. The actual reviewer
  // name + timestamp are stamped into the payload on save (see below).
  const isAdmin = currentUser?.role === 'admin';
  const [reviewed, setReviewed] = useState<boolean>(!!incident?.reviewed_at);

  // Failure types (by label) that REQUIRE a Failed Component to be selected.
  const FAILURE_TYPES_REQUIRING_COMPONENT = [
    'Low Order',
    'Stem Life Expectancy Not Reached',
    'Manufacturing',
    'Vendor Defect',
    'Design',
  ];

  // AI assistant side-panel state. The panel reads/writes the six free-text
  // fields below directly through refs so we don't have to convert the rest
  // of the form away from its uncontrolled FormData submission pattern.
  const [aiOpen, setAiOpen] = useState(false);
  const [aiField, setAiField] = useState<AssistantField>('incident_description');
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRefs: Record<AssistantField, React.RefObject<HTMLTextAreaElement>> = {
    incident_description: useRef<HTMLTextAreaElement>(null),
    investigation: useRef<HTMLTextAreaElement>(null),
    root_cause: useRef<HTMLTextAreaElement>(null),
    corrective_action: useRef<HTMLTextAreaElement>(null),
    preventive_action: useRef<HTMLTextAreaElement>(null),
    notes: useRef<HTMLTextAreaElement>(null),
  };

  const getFieldText = (f: AssistantField): string =>
    textareaRefs[f].current?.value ?? '';

  const applyAcceptedText = (f: AssistantField, text: string) => {
    const el = textareaRefs[f].current;
    if (!el) return;
    // Mutating .value on an uncontrolled textarea is invisible to React, but
    // FormData reads the DOM value at submit, so this is enough for save.
    el.value = text;
    // Fire an input event so any future controlled wiring still sees it.
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const focusAssistantField = (f: AssistantField) => {
    const el = textareaRefs[f].current;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.focus();
  };

  const buildIncidentSnapshot = (): IncidentSnapshot => {
    const form = formRef.current;
    const getInput = (name: string): string => {
      if (!form) return '';
      const el = form.elements.namedItem(name);
      if (!el) return '';
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
        return el.value || '';
      }
      return '';
    };

    // The component selects use row_ids; resolve them to human labels so the
    // review prompt sees readable values instead of opaque IDs.
    const failedComponentRaw = getInput('failed_component');
    const componentsMap: Record<string, { failed_component?: string | null }> = {};
    for (const c of components) {
      if (c?.row_id) componentsMap[c.row_id as string] = { failed_component: c.failed_component };
    }
    const listsMap: Record<string, { failure_type?: string | null }> = {};
    for (const l of listItems) {
      if (l?.row_id) listsMap[l.row_id as string] = { failure_type: l.failure_type };
    }

    return {
      incident_description: getFieldText('incident_description'),
      investigation: getFieldText('investigation'),
      root_cause: getFieldText('root_cause'),
      corrective_action: getFieldText('corrective_action'),
      preventive_action: getFieldText('preventive_action'),
      notes: getFieldText('notes'),
      incident_status: getInput('incident_status'),
      action_status: getInput('action_status'),
      xc_caused: getInput('xc_caused'),
      vendor_caused: getInput('vendor_caused'),
      event_category: getInput('event_category'),
      incident_severity: getInput('incident_severity'),
      closed_date: getInput('closed_date'),
      report_sent: incident?.report_sent,
      failed_component_label: resolveFailedComponentLabel(failedComponentRaw, componentsMap),
      failure_type_label: resolveFailureTypeLabel(getInput('failure_type'), listsMap),
      customer_label: customers.find((c) => c.row_id === custId)?.customer || '',
    };
  };


  // ── Effects ─────────────────────────────────────────────────────────────────

  // Fetch next available Event ID — scan ALL event_ids and find the true numeric max.
  // We can't .order() because Supabase sorts event_id as text (e.g. "99" > "556").
  // We MUST paginate: Supabase caps a single .select() at 1000 rows, so an
  // unbounded select silently misses higher IDs once incidents grows past 1000.
  useEffect(() => {
    if (!open || editing) return;
    let cancelled = false;
    (async () => {
      const PAGE = 1000;
      let from = 0;
      let maxId = 0;
      while (true) {
        const { data, error } = await supabase
          .from('incidents')
          .select('event_id')
          .range(from, from + PAGE - 1);
        if (error || !data) break;
        for (const row of data as any[]) {
          const n = parseInt(row.event_id);
          if (!isNaN(n) && n > maxId) maxId = n;
        }
        if (data.length < PAGE) break;
        from += PAGE;
      }
      if (!cancelled) setNextEventId(String(maxId + 1));
    })();
    return () => { cancelled = true; };
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

  // Load recent QC pallets (build slips) so an incident can be linked to the
  // build it came from. qc_pallets.customer is stored as the customer NAME
  // (not the customers.row_id used by incidents), so we don't filter by
  // customer here — we show the most recent builds globally and let the user
  // pick the right build_no.
  useEffect(() => {
    if (!open) return;
    supabase
      .from('qc_pallets')
      .select('row_id, build_no, customer, sales_order, status, created_at')
      .order('created_at', { ascending: false })
      .limit(100)
      .then(({ data }) => setQcPallets(data || []));
  }, [open]);

  // Pre-fill when editing, or seed a new incident from `prefill` (Log Incident
  // from a Field Visit or a QC build slip). `prefill` only applies when not editing.
  useEffect(() => {
    if (incident) {
      setCustId(incident.customer || '');
      setDistId(incident.customer_district || '');
      setVendorCaused(incident.vendor_caused || '');
      setFailureType(incident.failure_type || '');
    } else if (prefill) {
      setCustId(prefill.customer || '');
      setDistId(prefill.customer_district || '');
      setVendorCaused('');
      setFailureType('');
    } else {
      setCustId('');
      setDistId('');
      setVendorCaused('');
      setFailureType('');
    }
  }, [incident, prefill, open]);

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

    // ── Conditional field rules ──────────────────────────────────────────────
    const vendorCausedVal = String(fd.get('vendor_caused') || '');
    const vendorVal = String(fd.get('vendor') || '');
    // 1) Vendor must be selected when the incident was vendor-caused.
    if (vendorCausedVal === 'Yes' && !vendorVal) {
      toast.error('Vendor is required when Vendor Caused is "Yes".');
      return;
    }

    // 2) Failed Component is required for certain failure types. The select
    //    stores the lists row_id, so resolve it to its label first.
    const failureTypeId = String(fd.get('failure_type') || '');
    const failureTypeLabel =
      listItems.find((l: any) => l.row_id === failureTypeId)?.failure_type || '';
    const componentVal = String(fd.get('failed_component') || '');
    if (
      FAILURE_TYPES_REQUIRING_COMPONENT.includes(failureTypeLabel) &&
      !componentVal
    ) {
      toast.error(
        `Failed Component is required when Failure Type is "${failureTypeLabel}".`,
      );
      return;
    }

    setSaving(true);

    // The DB enforces action_status ∈ {Open, In Progress, Complete}. Normalize
    // whatever the form submitted (and force Complete when the incident is
    // moving to Closed) so we never trip incidents_action_status_check.
    const normalizedTargetStatus = normalizeStatus(targetStatus);
    const rawActionStatus = (fd.get('action_status') as string | null) || null;
    const persistedActionStatus =
      normalizedTargetStatus === CLOSED_STATUS
        ? ACTION_STATUS_COMPLETE
        : normalizeActionStatus(rawActionStatus);

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
      qc_pallet_id: fd.get('qc_pallet_id') || null,
      // Denormalize the human-facing build slip number from the selected pallet
      // so lists/detail views can show it without a join.
      qc_build_no:
        qcPallets.find((p: any) => p.row_id === fd.get('qc_pallet_id'))?.build_no ||
        (fd.get('qc_pallet_id') ? (incident?.qc_build_no || prefill?.qc_build_no || null) : null),
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
      action_status: persistedActionStatus,
      closed_date: fd.get('closed_date') || null,
      closed_by: fd.get('closed_by') || null,
      report_version: fd.get('report_version') || null,
      notes: fd.get('notes') || null,
    };

    // Director Review sign-off (admin-only). SQM users can't change this, so we
    // only touch reviewed_by/reviewed_at when an admin actually flipped the
    // control — otherwise we leave the columns untouched.
    //  - newly set      → stamp the admin + now()
    //  - cleared        → explicit null on both (supabase-js keeps explicit null)
    //  - unchanged      → omit (don't overwrite an existing reviewer/timestamp)
    if (isAdmin) {
      const wasReviewed = !!incident?.reviewed_at;
      if (reviewed && !wasReviewed) {
        payload.reviewed_by = currentUser?.name || currentUser?.email || 'Director';
        payload.reviewed_at = new Date().toISOString();
      } else if (!reviewed && wasReviewed) {
        payload.reviewed_by = null;
        payload.reviewed_at = null;
      }
    }
    // Note: the `incidents` table has no `updated_by` column — edit attribution
    // is captured via the `incident_updates` timeline, not a column here.

    if (!editing) {
      payload.event_id = fd.get('event_id') || '';
    }

    try {
      const { data: savedRows, error } = editing
        ? await supabase
            .from('incidents')
            .update(payload)
            .eq('row_id', incident.row_id)
            .select('row_id')
        : await supabase.from('incidents').insert(payload).select('row_id');

      if (error) throw new Error(error.message);

      // Regenerate the cached AI summary in the background (non-blocking) so the
      // dashboard cards stay current. The user never waits on the LLM.
      const savedRowId = savedRows?.[0]?.row_id ?? (editing ? incident.row_id : null);
      if (savedRowId) {
        const snap = buildIncidentSnapshot();
        void generateAndStoreIncidentSummary(savedRowId, {
          ...snap,
          well_name: (fd.get('well_name') as string) || null,
          stage_number: (fd.get('stage_number') as string) || null,
        });
      }

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

  // Conditional-requirement derivations (drive UI cues + disabled state).
  const selectedFailureTypeLabel =
    listItems.find((l: any) => l.row_id === failureType)?.failure_type || '';
  const componentRequired = FAILURE_TYPES_REQUIRING_COMPONENT.includes(
    selectedFailureTypeLabel,
  );
  const vendorActive = vendorCaused === 'Yes';

  const edgeBaseUrl = `https://${projectId}.supabase.co/functions/v1/make-server-64775d98`;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent
        className="max-w-4xl max-h-[90vh] flex flex-col p-0 gap-0"
        // The AI Assistant panel is portal'd to <body>, so it lives outside this
        // Dialog's DOM tree. Without these guards, Radix treats any click/focus
        // inside the panel as an "outside" interaction and auto-dismisses the
        // Dialog (closing both the form and the panel). Keep the Dialog open
        // when the interaction originated inside the AI panel.
        onPointerDownOutside={(e) => {
          if ((e.target as HTMLElement)?.closest?.('[data-ai-assistant-panel]')) {
            e.preventDefault();
          }
        }}
        onInteractOutside={(e) => {
          if ((e.target as HTMLElement)?.closest?.('[data-ai-assistant-panel]')) {
            e.preventDefault();
          }
        }}
        onFocusOutside={(e) => {
          if ((e.target as HTMLElement)?.closest?.('[data-ai-assistant-panel]')) {
            e.preventDefault();
          }
        }}
      >
        <DialogHeader className="px-6 pt-5 pb-3 border-b shrink-0">
          <div className="flex items-center justify-between gap-3">
            <DialogTitle>
              {editing
                ? `Edit Incident #${incident.event_id}`
                : 'Report New Incident'}
            </DialogTitle>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5 mr-8"
              onClick={() => setAiOpen(true)}
              title="Open the AI writing/review assistant"
            >
              <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
              AI Assistant
            </Button>
          </div>
        </DialogHeader>

        <form
          id="incident-form"
          ref={formRef}
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
                  className="font-mono bg-gray-50 dark:bg-gray-800/50 cursor-not-allowed"
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
                className="w-full border border-gray-300 dark:border-gray-600 rounded-md p-2 text-sm"
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
                className="w-full border border-gray-300 dark:border-gray-600 rounded-md p-2 text-sm"
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
              <Sel
                name="xc_district"
                defaultValue={incident?.xc_district || ''}
              >
                <option value="">— Select —</option>
                {XC_BASES.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
                {/* Preserve any legacy free-text value (e.g. "Permian Basin")
                    so historical incidents keep displaying; only new entries
                    are constrained to the standard XC base list. */}
                {incident?.xc_district &&
                  !XC_BASES.includes(incident.xc_district as any) && (
                    <option value={incident.xc_district}>
                      {incident.xc_district} (legacy)
                    </option>
                  )}
              </Sel>
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
              <Input
                key={`so-${incident?.row_id || prefill?.so_number || 'new'}`}
                name="so_number"
                defaultValue={incident?.so_number || prefill?.so_number || ''}
              />
            </F>

            <F label="Field Visit">
              <Sel
                key={`fv-${incident?.row_id || prefill?.field_visit_id || 'new'}-${fieldVisits.length}`}
                name="field_visit_id"
                defaultValue={incident?.field_visit_id || prefill?.field_visit_id || ''}
              >
                <option value="">— None / Not linked —</option>
                {/* Fallback: if editing an incident (or pre-linking from a Field Visit)
                    whose visit isn't in the latest-50 list, still show it so the
                    link isn't silently dropped on save. */}
                {(() => {
                  const linkedId = incident?.field_visit_id || prefill?.field_visit_id;
                  return linkedId &&
                    !fieldVisits.some((v: any) => v.field_visit_id === linkedId) ? (
                      <option value={linkedId}>
                        {linkedId} (linked visit)
                      </option>
                    ) : null;
                })()}
                {fieldVisits.map((v: any) => (
                  <option key={v.row_id} value={v.field_visit_id}>
                    {v.field_visit_id} — {v.pad_name || 'No pad'} (
                    {v.arrival_date?.slice(0, 10) || 'No date'})
                  </option>
                ))}
              </Sel>
            </F>

            {/* Link to the QC pallet / build slip the failed gun came from.
                Stores the pallet row_id; build_no is denormalized on save. */}
            <F label="QC Pallet / Build Slip">
              <Sel
                key={`qcp-${incident?.row_id || prefill?.qc_pallet_id || 'new'}-${qcPallets.length}`}
                name="qc_pallet_id"
                defaultValue={incident?.qc_pallet_id || prefill?.qc_pallet_id || ''}
              >
                <option value="">— None / Not linked —</option>
                {/* Fallback: if the linked build isn't in the recent-100 list,
                    still show it so the link isn't dropped on save. */}
                {(() => {
                  const linkedId = incident?.qc_pallet_id || prefill?.qc_pallet_id;
                  const linkedNo = incident?.qc_build_no || prefill?.qc_build_no;
                  return linkedId &&
                    !qcPallets.some((p: any) => p.row_id === linkedId) ? (
                      <option value={linkedId}>
                        {linkedNo || linkedId} (linked build)
                      </option>
                    ) : null;
                })()}
                {qcPallets.map((p: any) => (
                  <option key={p.row_id} value={p.row_id}>
                    {p.build_no || '(no build #)'} — {p.customer || 'No customer'}
                    {p.sales_order ? ` · SO ${p.sales_order}` : ''}
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

            <F label="Failed Component" required={componentRequired}>
              {/* Authoritative source: the `components` table (verified in DB).
                  All 371 incidents resolve cleanly through components — no
                  need to surface `lists` rows here.
                  Required when Failure Type is one of the manufacturing/design
                  defect types (see FAILURE_TYPES_REQUIRING_COMPONENT). */}
              <Sel
                key={`fc-${incident?.row_id}-${components.length}`}
                name="failed_component"
                defaultValue={incident?.failed_component || ''}
                required={componentRequired}
              >
                <option value="">— Select —</option>
                {components.map((c: any) => (
                  <option key={c.row_id} value={c.row_id}>
                    {c.failed_component}
                  </option>
                ))}
                {/* Last-resort: if the saved value isn't in the components
                    list (orphan id), keep it as a hidden current value so
                    unrelated edits don't clobber the field. */}
                {incident?.failed_component &&
                  !components.some((c: any) => c.row_id === incident.failed_component) && (
                    <option value={incident.failed_component}>
                      {incident.failed_component} (unknown)
                    </option>
                  )}
              </Sel>
            </F>

            <F label="Failure Type">
              <Sel
                name="failure_type"
                value={failureType}
                onChange={setFailureType}
              >
                <option value="">— Select —</option>
                {uniqueFailureTypes.map((l: any) => (
                  <option key={l.row_id} value={l.row_id}>
                    {l.failure_type}
                  </option>
                ))}
              </Sel>
            </F>

            {/* Vendor Caused drives whether Vendor is required/selectable. */}
            <F label="Vendor Caused">
              <Sel
                name="vendor_caused"
                value={vendorCaused}
                onChange={setVendorCaused}
              >
                <option value="">— Select —</option>
                {opts(listItems, 'vendor_caused').map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Sel>
            </F>

            <F label="Vendor" required={vendorActive}>
              <Sel
                key={`vnd-${incident?.row_id}-${vendors.length}-${vendorActive}`}
                name="vendor"
                defaultValue={vendorActive ? (incident?.vendor || '') : ''}
                disabled={!vendorActive}
                required={vendorActive}
              >
                <option value="">
                  {vendorActive ? '— Select —' : '— Only when Vendor Caused = Yes —'}
                </option>
                {vendors.map((v: any) => (
                  <option key={v.row_id} value={v.row_id}>
                    {v.vendor}
                  </option>
                ))}
              </Sel>
            </F>
          </SectionCard>

          {/* 6. Investigation / Root Cause */}
          <SectionCard title="Investigation & Root Cause" cols={1}>
            <AssistField field="incident_description" label="Incident Description"
              refObj={textareaRefs.incident_description}
              defaultValue={incident?.incident_description || ''}
              placeholder="What happened?"
              onAiOpen={(f) => { setAiField(f); setAiOpen(true); }}
            />
            <AssistField field="investigation" label="Investigation"
              refObj={textareaRefs.investigation}
              defaultValue={incident?.investigation || ''}
              placeholder="What was found during investigation?"
              onAiOpen={(f) => { setAiField(f); setAiOpen(true); }}
            />
            <AssistField field="root_cause" label="Root Cause"
              refObj={textareaRefs.root_cause}
              defaultValue={incident?.root_cause || ''}
              placeholder="Root cause analysis"
              onAiOpen={(f) => { setAiField(f); setAiOpen(true); }}
            />
          </SectionCard>

          {/* 7. Corrective / Preventive Actions */}
          <SectionCard
            title="Corrective & Preventive Actions"
            description="Required to move beyond Investigating status."
          >
            <div className="md:col-span-2">
              <AssistField field="corrective_action" label="Corrective Action"
                refObj={textareaRefs.corrective_action}
                defaultValue={incident?.corrective_action || ''}
                placeholder="Actions taken to correct the issue"
                onAiOpen={(f) => { setAiField(f); setAiOpen(true); }}
              />
            </div>

            <div className="md:col-span-2">
              <AssistField field="preventive_action" label="Preventive Action"
                refObj={textareaRefs.preventive_action}
                defaultValue={incident?.preventive_action || ''}
                placeholder="Actions taken to prevent recurrence"
                onAiOpen={(f) => { setAiField(f); setAiOpen(true); }}
              />
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
              {/* The DB has a CHECK constraint:
                    action_status IN ('Open','In Progress','Complete')
                  Source the options from ACTION_STATUSES so a typo like
                  "Completed" can never reach Supabase. Friendly UI labels
                  come from ACTION_STATUS_LABELS; the saved value is the
                  canonical literal. */}
              <Sel
                name="action_status"
                defaultValue={normalizeActionStatus(incident?.action_status) ?? ''}
              >
                <option value="">— Select —</option>
                {ACTION_STATUSES.map((o) => (
                  <option key={o} value={o}>
                    {ACTION_STATUS_LABELS[o]}
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

            {/* Director Review sign-off. Admin can set/clear inline; SQM sees a
                read-only status. Spans both columns. */}
            <div className="md:col-span-2">
              <Label className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1 block">
                Director Review
              </Label>
              {isAdmin ? (
                <div className="flex items-center gap-3 rounded-md border border-gray-200 dark:border-gray-700 px-3 py-2">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={reviewed}
                      onChange={(e) => setReviewed(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      {reviewed ? 'Reviewed' : 'Not reviewed'}
                    </span>
                  </label>
                  <span className="text-xs text-gray-500">
                    {incident?.reviewed_at
                      ? `Reviewed by ${incident.reviewed_by || 'Director'} on ${new Date(incident.reviewed_at).toLocaleDateString()}`
                      : reviewed
                        ? `Will be stamped to ${currentUser?.name || currentUser?.email || 'Director'} on save`
                        : 'Toggle on to sign off as reviewed'}
                  </span>
                </div>
              ) : (
                <div className="rounded-md border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm">
                  {incident?.reviewed_at ? (
                    <span className="inline-flex items-center gap-1.5 text-emerald-600 font-medium">
                      ✓ Reviewed by {incident.reviewed_by || 'Director'} on {new Date(incident.reviewed_at).toLocaleDateString()}
                    </span>
                  ) : (
                    <span className="text-gray-500">Not yet reviewed — director sign-off required.</span>
                  )}
                </div>
              )}
            </div>
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
            <AssistField field="notes" label="Notes"
              refObj={textareaRefs.notes}
              defaultValue={incident?.notes || ''}
              rows={2}
              onAiOpen={(f) => { setAiField(f); setAiOpen(true); }}
            />
          </SectionCard>
        </form>

        <IncidentAIAssistant
          open={aiOpen}
          onClose={() => setAiOpen(false)}
          field={aiField}
          onFieldChange={setAiField}
          getFieldText={getFieldText}
          getIncidentSnapshot={buildIncidentSnapshot}
          onAccept={applyAcceptedText}
          onFocusField={focusAssistantField}
        />

        {/* Sticky footer actions — always visible regardless of scroll */}
        <div className="flex justify-end gap-3 px-6 py-3 border-t bg-white dark:bg-gray-800 shrink-0">
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
