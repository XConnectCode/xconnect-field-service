/**
 * Data layer for SQM customer-training checklists.
 *
 *  - training_checklist_templates: admin-defined templates (one per product
 *    line / XFire software). `steps` = ordered [{ id, text }].
 *  - training_checklist_sessions: an SQM filling out a template for a
 *    specific customer training, optionally linked to a field visit.
 *    `step_results` = [{ id, text, done }].
 *
 * Tables created in database-migrations/training_checklists.sql
 */
import { supabase } from './supabase';

export interface ChecklistStep { id: string; text: string; }
export interface ChecklistStepResult { id: string; text: string; done: boolean; }

export interface ChecklistTemplate {
  id: string;
  name: string;
  product_line: string | null;
  kind: 'product' | 'xfire' | 'general' | string;
  description: string | null;
  steps: ChecklistStep[];
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChecklistSession {
  id: string;
  template_id: string | null;
  template_name: string | null;
  product_line: string | null;
  kind: string | null;
  field_visit_id: string | null;
  customer: string | null;
  customer_district: string | null;
  location: string | null;
  trainer_name: string | null;
  trainer_id: string | null;
  training_date: string;
  step_results: ChecklistStepResult[];
  notes: string | null;
  signoff_name: string | null;
  status: 'in_progress' | 'completed' | string;
  completed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export function isMissingTableError(err: any): boolean {
  return err?.code === 'PGRST205' || (typeof err?.message === 'string' && err.message.includes('could not find'));
}

// ── Templates ────────────────────────────────────────────────────────────────
export async function listTemplates(includeInactive = false): Promise<ChecklistTemplate[]> {
  let q = supabase.from('training_checklist_templates').select('*').order('name');
  if (!includeInactive) q = q.eq('active', true);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []) as ChecklistTemplate[];
}

export async function getTemplate(id: string): Promise<ChecklistTemplate | null> {
  const { data, error } = await supabase.from('training_checklist_templates').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return (data as ChecklistTemplate) || null;
}

export async function saveTemplate(t: Partial<ChecklistTemplate> & { id?: string }): Promise<ChecklistTemplate> {
  const payload = {
    name: t.name,
    product_line: t.product_line ?? null,
    kind: t.kind ?? 'product',
    description: t.description ?? null,
    steps: t.steps ?? [],
    active: t.active ?? true,
    updated_at: new Date().toISOString(),
  };
  if (t.id) {
    const { data, error } = await supabase
      .from('training_checklist_templates').update(payload).eq('id', t.id).select('*').single();
    if (error) throw error;
    return data as ChecklistTemplate;
  }
  const { data, error } = await supabase
    .from('training_checklist_templates')
    .insert({ ...payload, created_by: t.created_by ?? null })
    .select('*').single();
  if (error) throw error;
  return data as ChecklistTemplate;
}

export async function deleteTemplate(id: string): Promise<void> {
  const { error } = await supabase.from('training_checklist_templates').delete().eq('id', id);
  if (error) throw error;
}

// ── Sessions ─────────────────────────────────────────────────────────────────
export async function listSessions(): Promise<ChecklistSession[]> {
  const { data, error } = await supabase
    .from('training_checklist_sessions').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as ChecklistSession[];
}

export async function listSessionsForVisit(fieldVisitId: string): Promise<ChecklistSession[]> {
  if (!fieldVisitId) return [];
  const { data, error } = await supabase
    .from('training_checklist_sessions').select('*')
    .eq('field_visit_id', fieldVisitId)
    .order('created_at', { ascending: false });
  if (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
  return (data || []) as ChecklistSession[];
}

export async function getSession(id: string): Promise<ChecklistSession | null> {
  const { data, error } = await supabase
    .from('training_checklist_sessions').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return (data as ChecklistSession) || null;
}

/** Start a session from a template, snapshotting its steps. */
export async function startSession(params: {
  template: ChecklistTemplate;
  fieldVisitId?: string | null;
  customer?: string | null;
  customerDistrict?: string | null;
  location?: string | null;
  trainerName?: string | null;
  trainerId?: string | null;
  createdBy?: string | null;
}): Promise<ChecklistSession> {
  const { template, fieldVisitId, customer, customerDistrict, location, trainerName, trainerId, createdBy } = params;
  const step_results: ChecklistStepResult[] = (template.steps || []).map((s) => ({
    id: s.id, text: s.text, done: false,
  }));
  const payload = {
    template_id: template.id,
    template_name: template.name,
    product_line: template.product_line,
    kind: template.kind,
    field_visit_id: fieldVisitId || null,
    customer: customer || null,
    customer_district: customerDistrict || null,
    location: location || null,
    trainer_name: trainerName || null,
    trainer_id: trainerId || null,
    step_results,
    status: 'in_progress',
    created_by: createdBy || null,
  };
  const { data, error } = await supabase
    .from('training_checklist_sessions').insert(payload).select('*').single();
  if (error) throw error;
  return data as ChecklistSession;
}

export async function updateSession(id: string, patch: Partial<ChecklistSession>): Promise<ChecklistSession> {
  const payload: any = { ...patch, updated_at: new Date().toISOString() };
  if (patch.status === 'completed' && !patch.completed_at) {
    payload.completed_at = new Date().toISOString();
  }
  const { data, error } = await supabase
    .from('training_checklist_sessions').update(payload).eq('id', id).select('*').single();
  if (error) throw error;
  return data as ChecklistSession;
}

export async function deleteSession(id: string): Promise<void> {
  const { error } = await supabase.from('training_checklist_sessions').delete().eq('id', id);
  if (error) throw error;
}

/** Load Training-purpose field visits for the link picker. */
export async function listTrainingVisits(limit = 200): Promise<Array<{ field_visit_id: string; customer: string | null; arrival_date: string | null; }>> {
  const { data, error } = await supabase
    .from('fieldvisits')
    .select('field_visit_id, customer, arrival_date, visit_purpose')
    .eq('visit_purpose', 'Training')
    .order('arrival_date', { ascending: false })
    .limit(limit);
  if (error) {
    console.error('listTrainingVisits error:', error);
    return [];
  }
  const rows = data || [];
  // `fieldvisits.customer` stores the customer row_id, not the display name.
  // Resolve to readable customer names (same mapping FieldVisitDetail uses).
  const custIds = Array.from(
    new Set(rows.map((r: any) => r.customer).filter((c: any): c is string => !!c))
  );
  const nameById = new Map<string, string>();
  if (custIds.length) {
    const { data: custs, error: custErr } = await supabase
      .from('customers')
      .select('row_id, customer')
      .in('row_id', custIds);
    if (custErr) console.error('listTrainingVisits customer lookup error:', custErr);
    for (const c of custs || []) {
      if (c?.row_id) nameById.set(c.row_id, c.customer ?? null);
    }
  }
  return rows.map((r: any) => ({
    field_visit_id: r.field_visit_id,
    // Prefer resolved name; fall back to raw value so the option is never blank.
    customer: (r.customer && nameById.get(r.customer)) || r.customer || null,
    arrival_date: r.arrival_date ?? null,
  }));
}

// ── Customer / district reference data + auto-fill ────────────────────────────

export interface CustomerOption { row_id: string; customer: string; }
export interface DistrictOption { row_id: string; customer_district: string; }

/** All customers for the start-session dropdown (row_id + display name). */
export async function listCustomers(): Promise<CustomerOption[]> {
  const { data, error } = await supabase
    .from('customers').select('row_id, customer').order('customer');
  if (error) { console.error('listCustomers error:', error); return []; }
  return (data || []).filter((c: any) => c?.row_id) as CustomerOption[];
}

/**
 * All product lines for the checklist-template dropdown, pulled from the
 * canonical `lists.xc_products` column (the same source the Manage Lists screen
 * and the Incident form use). This replaces a stale hard-coded array so newly
 * added product lines (e.g. DSX2, Haptix, RAIL 2.75", 3rd Party) appear without
 * a code change. `extra` lets the caller fold in any value already saved on an
 * existing template so it is never dropped from its own dropdown.
 */
export async function listProductLines(extra: (string | null | undefined)[] = []): Promise<string[]> {
  const { data, error } = await supabase.from('lists').select('xc_products');
  if (error) console.error('listProductLines error:', error);
  const set = new Set<string>();
  for (const row of (data || [])) {
    const v = (row?.xc_products ?? '').toString().trim();
    if (v) set.add(v);
  }
  for (const v of extra) {
    const t = (v ?? '').toString().trim();
    if (t) set.add(t);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

/** Districts belonging to one customer (cascades off the customer select). */
export async function listDistrictsForCustomer(customerId: string): Promise<DistrictOption[]> {
  if (!customerId) return [];
  const { data, error } = await supabase
    .from('districts').select('row_id, customer_district')
    .eq('customer', customerId).order('customer_district');
  if (error) { console.error('listDistrictsForCustomer error:', error); return []; }
  return (data || []).filter((d: any) => d?.row_id) as DistrictOption[];
}

/**
 * Values needed to auto-fill the start-session form from a linked field visit.
 * Returns the customer row_id, district row_id and pad/location so the modal can
 * pre-select the matching dropdown options.
 */
export async function getVisitAutofill(fieldVisitId: string): Promise<{
  customer: string | null;
  customer_district: string | null;
  location: string | null;
} | null> {
  if (!fieldVisitId) return null;
  const { data, error } = await supabase
    .from('fieldvisits')
    .select('customer, customer_district, pad_name')
    .eq('field_visit_id', fieldVisitId)
    .maybeSingle();
  if (error) { console.error('getVisitAutofill error:', error); return null; }
  if (!data) return null;
  return {
    customer: data.customer ?? null,
    customer_district: data.customer_district ?? null,
    location: data.pad_name ?? null,
  };
}

/**
 * Resolve a session's stored customer + district (which may be customers.row_id
 * / districts.row_id, or a legacy free-text customer name) to display names.
 * Falls back to the raw stored value so nothing renders blank.
 */
export async function resolveSessionNames(
  customer: string | null,
  customerDistrict: string | null,
): Promise<{ customerName: string | null; districtName: string | null }> {
  let customerName = customer || null;
  let districtName = customerDistrict || null;
  try {
    if (customer) {
      const { data } = await supabase
        .from('customers').select('customer').eq('row_id', customer).maybeSingle();
      if (data?.customer) customerName = data.customer;
    }
    if (customerDistrict) {
      const { data } = await supabase
        .from('districts').select('customer_district').eq('row_id', customerDistrict).maybeSingle();
      if (data?.customer_district) districtName = data.customer_district;
    }
  } catch (e) {
    console.error('resolveSessionNames error:', e);
  }
  return { customerName, districtName };
}
