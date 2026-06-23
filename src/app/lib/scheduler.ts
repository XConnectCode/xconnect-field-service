/**
 * Data layer for the Scheduler feature.
 *
 *  - scheduled_training_visits: upcoming SQM training visits (by planned_date).
 *  - panel_install_needs: upcoming panel needs for customer installs
 *    (by needed_by_date).
 *
 * Both tables live in the public schema with RLS disabled and full grants,
 * accessed directly via the shared supabase client — same convention as the
 * training_checklist_* tables (see ./trainingChecklists.ts).
 *
 * customer / customer_district store the customers.row_id / districts.row_id
 * FK strings (same as fieldvisits) and are resolved to display names in the UI.
 */
import { supabase } from './supabase';

// Fixed panel-type list for panel_install_needs.panel_type.
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

export const TRAINING_STATUSES = ['planned', 'completed', 'cancelled'];
export const PANEL_NEED_STATUSES = ['open', 'fulfilled', 'cancelled'];

// Shared category list — applies to BOTH training visits and panel needs, since
// a single category (e.g. 'Software Training') can describe either record type.
export const SCHEDULER_CATEGORIES = [
  'Software Training',
  'Hardware/Equipment Training',
  'Panel Install',
  'Maintenance',
  'Other',
];

// ── Record shapes ─────────────────────────────────────────────────────────────
export interface ScheduledTraining {
  id: string;
  sqm_name: string | null;
  sqm_email: string | null;
  customer: string | null;
  customer_district: string | null;
  operating_company: string | null;
  product_line: string | null;
  planned_date: string | null;
  status: string | null;
  notes: string | null;
  category: string | null;
  linked_panel_need_id: string | null;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface PanelInstallNeed {
  id: string;
  customer: string | null;
  customer_district: string | null;
  operating_company: string | null;
  panel_type: string | null;
  qty_needed: number | null;
  needed_by_date: string | null;
  status: string | null;
  notes: string | null;
  category: string | null;
  linked_training_id: string | null;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

// ── Scheduled training visits ─────────────────────────────────────────────────
export async function listScheduledTrainings(): Promise<ScheduledTraining[]> {
  const { data, error } = await supabase
    .from('scheduled_training_visits')
    .select('*')
    .order('planned_date', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function createScheduledTraining(data: any): Promise<any> {
  const { data: row, error } = await supabase
    .from('scheduled_training_visits')
    .insert(data)
    .select('*')
    .single();
  if (error) throw error;
  return row;
}

export async function updateScheduledTraining(id: string, data: any): Promise<any> {
  const payload = { ...data, updated_at: new Date().toISOString() };
  const { data: row, error } = await supabase
    .from('scheduled_training_visits')
    .update(payload)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return row;
}

export async function deleteScheduledTraining(id: string): Promise<void> {
  const { error } = await supabase.from('scheduled_training_visits').delete().eq('id', id);
  if (error) throw error;
}

// ── Panel install needs ───────────────────────────────────────────────────────
export async function listPanelInstallNeeds(): Promise<PanelInstallNeed[]> {
  const { data, error } = await supabase
    .from('panel_install_needs')
    .select('*')
    .order('needed_by_date', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function createPanelInstallNeed(data: any): Promise<any> {
  const { data: row, error } = await supabase
    .from('panel_install_needs')
    .insert(data)
    .select('*')
    .single();
  if (error) throw error;
  return row;
}

export async function updatePanelInstallNeed(id: string, data: any): Promise<any> {
  const payload = { ...data, updated_at: new Date().toISOString() };
  const { data: row, error } = await supabase
    .from('panel_install_needs')
    .update(payload)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return row;
}

export async function deletePanelInstallNeed(id: string): Promise<void> {
  const { error } = await supabase.from('panel_install_needs').delete().eq('id', id);
  if (error) throw error;
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
