/**
 * Data layer for the Scheduler feature (unified model).
 *
 *  - scheduled_visits: a single visit/request row. `fulfillment_type` is either
 *    'on_site' (an SQM visit on a planned_date) or 'ship_only' (panels shipped,
 *    no on-site visit). `categories` is a text[] of SCHEDULER_CATEGORIES.
 *  - scheduled_visit_panels: child rows, one per panel needed for a visit
 *    (visit_id FK, cascade delete).
 *
 * Both tables live in the public schema with RLS disabled and full grants,
 * accessed directly via the shared supabase client.
 *
 * customer / customer_district store the customers.row_id / districts.row_id
 * FK strings (same as fieldvisits) and are resolved to display names in the UI.
 */
import { supabase } from './supabase';
import { schedulerApi } from './api';
import { toast } from 'sonner';

// Fixed panel-type list for scheduled_visit_panels.panel_type.
export const PANEL_TYPES = [
  'Digital Shooting Panel',
  'Master Safe Panel',
  'P1000',
  'P2000',
  'P2500',
  'Pressure Box',
  'Surface Tester',
  'Toolstring Simulator',
];

// Visit lifecycle statuses (applies to both fulfillment types).
export const VISIT_STATUSES = ['planned', 'confirmed', 'shipped', 'completed', 'cancelled'];

// Multi-select categories for on-site visits.
export const SCHEDULER_CATEGORIES = [
  'Software Training',
  'Hardware/Equipment Training',
  'Panel Install',
  'Maintenance',
  'Other',
];

// Fulfillment type options for the unified dialog.
export const FULFILLMENT_TYPES = [
  { value: 'on_site', label: 'On-site visit' },
  { value: 'ship_only', label: 'Ship-only (panels only)' },
];

// Activity types for a job's child activities (scheduled_visits.activity_type).
// Each carries a label plus tailwind tone tokens for badges/calendar bands.
export const ACTIVITY_TYPES = [
  { value: 'shipment', label: 'Shipment', tone: 'amber',
    badge: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    dot: 'bg-amber-500', band: 'border-amber-300 dark:border-amber-700' },
  { value: 'install', label: 'Install', tone: 'blue',
    badge: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
    dot: 'bg-blue-500', band: 'border-blue-300 dark:border-blue-700' },
  { value: 'training', label: 'Training', tone: 'green',
    badge: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
    dot: 'bg-emerald-500', band: 'border-emerald-300 dark:border-emerald-700' },
  { value: 'visit', label: 'Visit', tone: 'slate',
    badge: 'bg-slate-100 text-slate-800 dark:bg-slate-800/60 dark:text-slate-300',
    dot: 'bg-slate-500', band: 'border-slate-300 dark:border-slate-600' },
];

export function activityMeta(type: string | null | undefined) {
  return ACTIVITY_TYPES.find((a) => a.value === type) || ACTIVITY_TYPES[3];
}

// Maps scheduler activity types to valid "Visit Type" enum values (DB enum).
const ACTIVITY_TO_VISIT_PURPOSE: Record<string, string> = {
  install: 'XFire Installation',
  training: 'Training',
};

// Job lifecycle statuses (scheduled_jobs.status).
export const JOB_STATUSES = ['open', 'in_progress', 'completed', 'cancelled'];

// ── Record shapes ─────────────────────────────────────────────────────────────
export interface VisitPanel {
  id?: string;
  visit_id?: string;
  panel_type: string;
  qty_needed: number;
  needed_by_date: string | null;
  notes?: string | null;
  tracking_number?: string | null;
  tracking_url?: string | null;
  shipped_at?: string | null;
  panel_row_id?: string | null; // refs panels.row_id when a real serial is chosen
  created_at?: string | null;
  updated_at?: string | null;
}

export interface ScheduledVisit {
  id: string;
  fulfillment_type: string; // 'on_site' | 'ship_only'
  categories: string[];
  sqm_name: string | null;
  sqm_email: string | null;
  customer: string | null;
  customer_district: string | null;
  operating_company: string | null;
  product_line: string | null;
  planned_date: string | null;
  status: string | null;
  notes: string | null;
  tracking_number?: string | null;
  tracking_url?: string | null;
  shipped_at?: string | null;
  job_id?: string | null;
  sequence?: number | null;
  activity_type?: string | null; // 'shipment' | 'install' | 'training' | 'visit'
  field_visit_id?: string | null;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  panels?: VisitPanel[];
}

export interface ScheduledJob {
  id: string;
  title: string | null;
  customer: string | null;
  customer_district: string | null;
  operating_company: string | null;
  pad_name: string | null;
  product_line: string | null;
  status: string | null; // 'open' | 'in_progress' | 'completed' | 'cancelled'
  notes: string | null;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  activities?: ScheduledVisit[];
}

// ── Scheduled visits (with child panels) ──────────────────────────────────────
export async function listScheduledVisits(): Promise<ScheduledVisit[]> {
  const { data: visits, error } = await supabase
    .from('scheduled_visits')
    .select('*')
    .order('planned_date', { ascending: true });
  if (error) throw error;
  const rows = (visits || []) as ScheduledVisit[];
  if (!rows.length) return rows.map((v) => ({ ...v, categories: v.categories || [], panels: [] }));

  const ids = rows.map((v) => v.id);
  const { data: panels, error: pErr } = await supabase
    .from('scheduled_visit_panels')
    .select('*')
    .in('visit_id', ids)
    .order('needed_by_date', { ascending: true });
  if (pErr) throw pErr;

  const byVisit: Record<string, VisitPanel[]> = {};
  for (const p of (panels || []) as VisitPanel[]) {
    const vid = p.visit_id as string;
    (byVisit[vid] || (byVisit[vid] = [])).push(p);
  }
  return rows.map((v) => ({ ...v, categories: v.categories || [], panels: byVisit[v.id] || [] }));
}

function panelInsertRows(visitId: string, panels: VisitPanel[]) {
  return (panels || [])
    .filter((p) => p && p.panel_type)
    .map((p) => ({
      visit_id: visitId,
      panel_type: p.panel_type,
      qty_needed: p.qty_needed != null && p.qty_needed >= 1 ? p.qty_needed : 1,
      needed_by_date: p.needed_by_date || null,
      notes: p.notes?.trim() || null,
      tracking_number: p.tracking_number?.trim() || null,
      tracking_url: p.tracking_url?.trim() || null,
      shipped_at: p.shipped_at || null,
      panel_row_id: p.panel_row_id || null,
    }));
}

export async function createScheduledVisit(
  visitData: Partial<ScheduledVisit>,
  panels: VisitPanel[],
): Promise<ScheduledVisit> {
  try {
    const { data: visit, error } = await supabase
      .from('scheduled_visits')
      .insert(visitData)
      .select('*')
      .single();
    if (error) throw error;

    const rows = panelInsertRows(visit.id, panels);
    if (rows.length) {
      const { error: pErr } = await supabase.from('scheduled_visit_panels').insert(rows);
      if (pErr) throw pErr;
    }
    return visit as ScheduledVisit;
  } catch (err: any) {
    toast.error(err?.message || 'Failed to create visit');
    throw err;
  }
}

export async function updateScheduledVisit(
  id: string,
  visitData: Partial<ScheduledVisit>,
  panels: VisitPanel[],
): Promise<ScheduledVisit> {
  try {
    const payload = { ...visitData, updated_at: new Date().toISOString() };
    const { data: visit, error } = await supabase
      .from('scheduled_visits')
      .update(payload)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;

    // Replace child panels: delete existing, then insert the provided set.
    const { error: delErr } = await supabase
      .from('scheduled_visit_panels')
      .delete()
      .eq('visit_id', id);
    if (delErr) throw delErr;

    const rows = panelInsertRows(id, panels);
    if (rows.length) {
      const { error: pErr } = await supabase.from('scheduled_visit_panels').insert(rows);
      if (pErr) throw pErr;
    }
    return visit as ScheduledVisit;
  } catch (err: any) {
    toast.error(err?.message || 'Failed to update visit');
    throw err;
  }
}

export async function deleteScheduledVisit(id: string): Promise<void> {
  try {
    const { error } = await supabase.from('scheduled_visits').delete().eq('id', id);
    if (error) throw error;
  } catch (err: any) {
    toast.error(err?.message || 'Failed to delete visit');
    throw err;
  }
}

/**
 * Quick action: flag a visit as shipped (status='shipped', shipped_at=now), with
 * an optional tracking number / link captured at the same moment. Only fields
 * provided are overwritten, so calling without tracking just stamps the ship.
 */
export async function markVisitShipped(
  id: string,
  opts: { tracking_number?: string | null; tracking_url?: string | null } = {},
): Promise<void> {
  try {
    const payload: Partial<ScheduledVisit> = {
      status: 'shipped',
      shipped_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (opts.tracking_number !== undefined) payload.tracking_number = opts.tracking_number?.trim() || null;
    if (opts.tracking_url !== undefined) payload.tracking_url = opts.tracking_url?.trim() || null;
    const { error } = await supabase.from('scheduled_visits').update(payload).eq('id', id);
    if (error) throw error;
  } catch (err: any) {
    toast.error(err?.message || 'Failed to mark shipped');
    throw err;
  }
}

// ── Scheduled jobs (umbrella) ─────────────────────────────────────────────────
/**
 * List jobs, each with its nested activities (scheduled_visits) and their
 * panels. One round trip per table, then stitched client-side.
 */
export async function listScheduledJobs(): Promise<ScheduledJob[]> {
  const { data: jobs, error } = await supabase
    .from('scheduled_jobs')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  const jobRows = (jobs || []) as ScheduledJob[];
  if (!jobRows.length) return [];

  const jobIds = jobRows.map((j) => j.id);
  const { data: acts, error: aErr } = await supabase
    .from('scheduled_visits')
    .select('*')
    .in('job_id', jobIds)
    .order('sequence', { ascending: true });
  if (aErr) throw aErr;
  const activities = (acts || []) as ScheduledVisit[];

  const actIds = activities.map((a) => a.id);
  let panelsByVisit: Record<string, VisitPanel[]> = {};
  if (actIds.length) {
    const { data: panels, error: pErr } = await supabase
      .from('scheduled_visit_panels')
      .select('*')
      .in('visit_id', actIds);
    if (pErr) throw pErr;
    for (const p of (panels || []) as VisitPanel[]) {
      const vid = p.visit_id as string;
      (panelsByVisit[vid] || (panelsByVisit[vid] = [])).push(p);
    }
  }

  const byJob: Record<string, ScheduledVisit[]> = {};
  for (const a of activities) {
    const withPanels = { ...a, categories: a.categories || [], panels: panelsByVisit[a.id] || [] };
    (byJob[a.job_id as string] || (byJob[a.job_id as string] = [])).push(withPanels);
  }
  return jobRows.map((j) => ({ ...j, activities: byJob[j.id] || [] }));
}

/** Fetch a single job's activities (with panels). */
export async function listActivitiesForJob(jobId: string): Promise<ScheduledVisit[]> {
  const { data: acts, error } = await supabase
    .from('scheduled_visits')
    .select('*')
    .eq('job_id', jobId)
    .order('sequence', { ascending: true });
  if (error) throw error;
  const activities = (acts || []) as ScheduledVisit[];
  if (!activities.length) return [];
  const ids = activities.map((a) => a.id);
  const { data: panels, error: pErr } = await supabase
    .from('scheduled_visit_panels').select('*').in('visit_id', ids);
  if (pErr) throw pErr;
  const byVisit: Record<string, VisitPanel[]> = {};
  for (const p of (panels || []) as VisitPanel[]) {
    const vid = p.visit_id as string;
    (byVisit[vid] || (byVisit[vid] = [])).push(p);
  }
  return activities.map((a) => ({ ...a, categories: a.categories || [], panels: byVisit[a.id] || [] }));
}

export async function createScheduledJob(jobData: Partial<ScheduledJob>): Promise<ScheduledJob> {
  try {
    const { data, error } = await supabase
      .from('scheduled_jobs')
      .insert({ ...jobData, status: jobData.status || 'open' })
      .select('*')
      .single();
    if (error) throw error;
    return data as ScheduledJob;
  } catch (err: any) {
    toast.error(err?.message || 'Failed to create job');
    throw err;
  }
}

export async function updateScheduledJob(id: string, jobData: Partial<ScheduledJob>): Promise<ScheduledJob> {
  try {
    const { data, error } = await supabase
      .from('scheduled_jobs')
      .update({ ...jobData, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    return data as ScheduledJob;
  } catch (err: any) {
    toast.error(err?.message || 'Failed to update job');
    throw err;
  }
}

/** Delete a job. Activities keep existing (job_id SET NULL via FK) as standalone. */
export async function deleteScheduledJob(id: string): Promise<void> {
  try {
    const { error } = await supabase.from('scheduled_jobs').delete().eq('id', id);
    if (error) throw error;
  } catch (err: any) {
    toast.error(err?.message || 'Failed to delete job');
    throw err;
  }
}

/**
 * Attach an existing unassigned activity to a job: stamp job_id, the next
 * sequence number, and an inferred activity_type when the activity has none
 * (ship-only → shipment, otherwise a generic visit). Then roll up job status.
 */
export async function assignActivityToJob(visit: ScheduledVisit, jobId: string): Promise<void> {
  try {
    const { data: existing, error: cErr } = await supabase
      .from('scheduled_visits').select('id').eq('job_id', jobId);
    if (cErr) throw cErr;
    const seq = (existing?.length || 0) + 1;
    const activityType = visit.activity_type
      || (visit.fulfillment_type === 'ship_only' ? 'shipment' : 'visit');
    const { error } = await supabase
      .from('scheduled_visits')
      .update({ job_id: jobId, sequence: seq, activity_type: activityType, updated_at: new Date().toISOString() })
      .eq('id', visit.id);
    if (error) throw error;
    await rollUpJobStatus(jobId).catch(() => null);
  } catch (err: any) {
    toast.error(err?.message || 'Failed to add activity to job');
    throw err;
  }
}

/**
 * Create a job from an unassigned activity's customer context, then attach the
 * activity to it. Returns the new job.
 */
export async function createJobFromActivity(
  visit: ScheduledVisit,
  opts: { title?: string | null; createdBy?: string | null } = {},
): Promise<ScheduledJob> {
  try {
    const job = await createScheduledJob({
      title: opts.title?.trim() || visit.product_line || 'Job',
      customer: visit.customer || null,
      customer_district: visit.customer_district || null,
      operating_company: visit.operating_company || null,
      product_line: visit.product_line || null,
      created_by: opts.createdBy || null,
    });
    await assignActivityToJob(visit, job.id);
    return job;
  } catch (err: any) {
    toast.error(err?.message || 'Failed to create job from activity');
    throw err;
  }
}

// ── Real inventory panels (serial picker) ─────────────────────────────────────
export interface AvailablePanel {
  row_id: string;
  serial_number: string | null;
  panel_type: string | null;
  panel_status: string | null;
  customer?: string | null;
}

/**
 * Real panels for the serial picker. Sorted so 'At Facility' (ready to ship)
 * surfaces first, then by serial. Optional panel_type filter narrows the list.
 */
export async function listAvailablePanels(panelType?: string): Promise<AvailablePanel[]> {
  let q = supabase
    .from('panels')
    .select('row_id, serial_number, panel_type, panel_status, customer');
  if (panelType) q = q.eq('panel_type', panelType);
  const { data, error } = await q.order('serial_number', { ascending: true });
  if (error) {
    console.error('listAvailablePanels error:', error);
    toast.error('Failed to load panels: ' + error.message);
    return [];
  }
  const rows = (data || []) as AvailablePanel[];
  const atFacility = (s: string | null) => (s || '').toLowerCase() === 'at facility';
  return rows.sort((a, b) => {
    const af = Number(atFacility(b.panel_status)) - Number(atFacility(a.panel_status));
    if (af !== 0) return af;
    return String(a.serial_number || '').localeCompare(String(b.serial_number || ''));
  });
}

/**
 * Mark a shipment activity shipped. For each child panel that references a real
 * inventory panel (panel_row_id), the live panels row is updated to
 * 'In Transit' with tracking + the job/visit customer context. The child panel
 * gets shipped_at, and the activity flips to status='shipped'.
 */
export async function markPanelsShipped(
  visit: ScheduledVisit,
  opts: { tracking_number?: string | null; tracking_url?: string | null } = {},
): Promise<void> {
  try {
    const tracking = opts.tracking_number?.trim() || visit.tracking_number?.trim() || null;
    const trackingUrl = opts.tracking_url?.trim() || visit.tracking_url?.trim() || null;

    // Resolve customer context (prefer the visit's own, fall back to its job).
    let cust = visit.customer || null;
    let dist = visit.customer_district || null;
    let opCo = visit.operating_company || null;
    if (visit.job_id && (!cust || !dist || !opCo)) {
      const { data: job } = await supabase
        .from('scheduled_jobs')
        .select('customer, customer_district, operating_company')
        .eq('id', visit.job_id).maybeSingle();
      if (job) {
        cust = cust || job.customer;
        dist = dist || job.customer_district;
        opCo = opCo || job.operating_company;
      }
    }

    // The actual inventory writes (panels UPDATE, scheduled_visit_panels +
    // scheduled_visits stamps, and the job roll-up) run server-side under the
    // service-role edge route — `panels` RLS has no anon write grant. We only
    // resolve/serialize the values here and hand them to the route.
    const panels = (visit.panels || []).map((p) => ({
      scheduled_visit_panel_id: p.id || null,
      panel_row_id: p.panel_row_id || null,
      panel_tracking_number: p.tracking_number?.trim() || null,
    }));

    await schedulerApi.markPanelsShipped({
      visit_id: visit.id,
      job_id: visit.job_id || null,
      customer: cust,
      customer_district: dist,
      operating_company: opCo,
      tracking_number: tracking,
      tracking_url: trackingUrl,
      panels,
    });
  } catch (err: any) {
    toast.error(err?.message || 'Failed to mark panels shipped');
    throw err;
  }
}

/**
 * Ship a shipment activity scheduled by panel TYPE + qty (a need): the actual
 * serials are chosen at ship time. Replaces the activity's child panel rows with
 * one row per chosen serial (direct client — scheduler-owned table), then hands
 * the real-panel writes to the `mark-panels-shipped` edge route via
 * markPanelsShipped. Each selection may carry a per-panel tracking override.
 */
export async function markShipmentShipped(
  visit: ScheduledVisit,
  selections: { panel_row_id: string; panel_type: string | null; needed_by_date?: string | null; tracking_number?: string | null }[],
  opts: { tracking_number?: string | null; tracking_url?: string | null } = {},
): Promise<void> {
  try {
    const { error: delErr } = await supabase
      .from('scheduled_visit_panels').delete().eq('visit_id', visit.id);
    if (delErr) throw delErr;

    const rows = selections.map((s) => ({
      visit_id: visit.id,
      panel_type: s.panel_type || 'Panel',
      qty_needed: 1,
      needed_by_date: s.needed_by_date || null,
      tracking_number: s.tracking_number?.trim() || null,
      tracking_url: null,
      shipped_at: null,
      panel_row_id: s.panel_row_id,
    }));

    let inserted: VisitPanel[] = [];
    if (rows.length) {
      const { data, error: insErr } = await supabase
        .from('scheduled_visit_panels').insert(rows).select('*');
      if (insErr) throw insErr;
      inserted = (data || []) as VisitPanel[];
    }

    await markPanelsShipped({ ...visit, panels: inserted }, opts);
  } catch (err: any) {
    toast.error(err?.message || 'Failed to mark panels shipped');
    throw err;
  }
}

// ── Field-visit linkage ───────────────────────────────────────────────────────
/** Next sequential numeric field_visit_id, scanning all rows (text-sorted col). */
async function nextFieldVisitId(): Promise<string> {
  const PAGE = 1000;
  let from = 0;
  let maxId = 0;
  while (true) {
    const { data, error } = await supabase
      .from('fieldvisits').select('field_visit_id').range(from, from + PAGE - 1);
    if (error || !data) break;
    for (const row of data as any[]) {
      const n = parseInt(row.field_visit_id, 10);
      if (!isNaN(n) && n > maxId) maxId = n;
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return String(maxId + 1);
}

export interface StartedFieldVisit { field_visit_id: string; row_id: string; }

/**
 * Create a fieldvisits row prefilled from an install/training activity, link it
 * both ways (scheduled_visits.field_visit_id ↔ fieldvisits.field_visit_id), and
 * return the new IDs. panels_seen is seeded from the activity's panel serials.
 */
export async function startFieldVisitForActivity(visit: ScheduledVisit): Promise<StartedFieldVisit> {
  try {
    const fvId = await nextFieldVisitId();

    // Seed panels_seen from the activity's real-panel serials (if any).
    let panelsSeen: string[] = [];
    const rowIds = (visit.panels || []).map((p) => p.panel_row_id).filter(Boolean) as string[];
    if (rowIds.length) {
      const { data: pr } = await supabase
        .from('panels').select('serial_number').in('row_id', rowIds);
      panelsSeen = (pr || []).map((r: any) => r.serial_number).filter(Boolean);
    }

    const purpose = visit.activity_type
      ? (ACTIVITY_TO_VISIT_PURPOSE[visit.activity_type] ?? null)
      : null;

    // The fieldvisits INSERT + scheduled_visits link run server-side under the
    // service-role edge route — `fieldvisits` RLS has no anon write grant.
    const res = await schedulerApi.startFieldVisit({
      visit_id: visit.id,
      field_visit_id: fvId,
      fieldvisit: {
        arrival_date: visit.planned_date || null,
        visit_purpose: purpose,
        field_or_facility: 'Field',
        customer: visit.customer || null,
        customer_district: visit.customer_district || null,
        operating_company: visit.operating_company || null,
        xc_rep: visit.sqm_name || null,
        panels_seen: panelsSeen,
      },
    });

    return { field_visit_id: res.field_visit_id, row_id: res.row_id };
  } catch (err: any) {
    toast.error(err?.message || 'Failed to start field visit');
    throw err;
  }
}

/**
 * Roll up a job's status from its activities. An activity linked to a completed
 * field visit is flipped to 'completed' first. Then: all activities completed →
 * job 'completed'; any started (not planned) → 'in_progress'; else 'open'.
 * Cancelled jobs are left untouched.
 */
export async function rollUpJobStatus(jobId: string): Promise<string | null> {
  const activities = await listActivitiesForJob(jobId);

  // Flip activities whose linked field visit is completed.
  const linkedIds = activities.map((a) => a.field_visit_id).filter(Boolean) as string[];
  let completedFvSet = new Set<string>();
  if (linkedIds.length) {
    const { data: fvs } = await supabase
      .from('fieldvisits').select('field_visit_id, completed_at').in('field_visit_id', linkedIds);
    for (const fv of (fvs || []) as any[]) {
      if (fv.completed_at) completedFvSet.add(String(fv.field_visit_id));
    }
  }
  for (const a of activities) {
    if (a.field_visit_id && completedFvSet.has(String(a.field_visit_id)) && a.status !== 'completed') {
      await supabase
        .from('scheduled_visits')
        .update({ status: 'completed', updated_at: new Date().toISOString() })
        .eq('id', a.id);
      a.status = 'completed';
    }
  }

  const { data: jobRow } = await supabase
    .from('scheduled_jobs').select('status').eq('id', jobId).maybeSingle();
  if (jobRow?.status === 'cancelled') return 'cancelled';

  const live = activities.filter((a) => a.status !== 'cancelled');
  let next = 'open';
  if (live.length && live.every((a) => a.status === 'completed')) {
    next = 'completed';
  } else if (live.some((a) => a.status && a.status !== 'planned')) {
    next = 'in_progress';
  }
  await supabase
    .from('scheduled_jobs')
    .update({ status: next, updated_at: new Date().toISOString() })
    .eq('id', jobId);
  return next;
}

// ── Picker / reference data ───────────────────────────────────────────────────
export interface SqmOption { name: string; email: string | null; }

/**
 * SQM dropdown source. The `sqm` table may be empty (externally synced); callers
 * also allow free-text entry as a fallback, mirroring xc_rep elsewhere.
 */
export async function listSqms(): Promise<SqmOption[]> {
  const { data, error } = await supabase.from('sqm').select('sq_manager, email').order('sq_manager');
  if (error) { console.error('listSqms error:', error); return []; }
  return (data || [])
    .filter((r: any) => r?.sq_manager && r.sq_manager !== 'Pre-Tracking')
    .map((r: any) => ({ name: r.sq_manager, email: r.email ?? null }));
}

export async function listCustomers(): Promise<any[]> {
  const { data, error } = await supabase.from('customers').select('row_id, customer').order('customer');
  if (error) { console.error('listCustomers error:', error); return []; }
  return (data || []).filter((c: any) => c?.row_id);
}

export async function listDistrictsForCustomer(customerId: string): Promise<any[]> {
  if (!customerId) return [];
  const { data, error } = await supabase
    .from('districts').select('row_id, customer_district')
    .eq('customer', customerId).order('customer_district');
  if (error) { console.error('listDistrictsForCustomer error:', error); return []; }
  return (data || []).filter((d: any) => d?.row_id);
}

/** Resolve a set of district row_ids to display names (for list/calendar). */
export async function listDistrictsByIds(ids: string[]): Promise<any[]> {
  const clean = Array.from(new Set(ids.filter(Boolean)));
  if (!clean.length) return [];
  const { data, error } = await supabase
    .from('districts').select('row_id, customer_district').in('row_id', clean);
  if (error) { console.error('listDistrictsByIds error:', error); return []; }
  return data || [];
}

export async function listEpCompanies(): Promise<string[]> {
  const { data, error } = await supabase.from('ep').select('operating_company').order('operating_company');
  if (error) { console.error('listEpCompanies error:', error); return []; }
  return (data || []).map((r: any) => r.operating_company).filter(Boolean);
}

/** Product lines from the canonical lists.xc_products column. */
export async function listProductLines(): Promise<string[]> {
  const { data, error } = await supabase.from('lists').select('xc_products');
  if (error) { console.error('listProductLines error:', error); return []; }
  const set = new Set<string>();
  for (const row of data || []) {
    const v = (row?.xc_products ?? '').toString().trim();
    if (v) set.add(v);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}
