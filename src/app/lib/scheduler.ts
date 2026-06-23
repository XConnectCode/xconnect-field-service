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
  'Toolstring Verifier',
];

// Visit lifecycle statuses (applies to both fulfillment types).
export const VISIT_STATUSES = ['planned', 'confirmed', 'completed', 'cancelled'];

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

// ── Record shapes ─────────────────────────────────────────────────────────────
export interface VisitPanel {
  id?: string;
  visit_id?: string;
  panel_type: string;
  qty_needed: number;
  needed_by_date: string | null;
  notes?: string | null;
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
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  panels?: VisitPanel[];
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
