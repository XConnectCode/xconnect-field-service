/**
 * incidentSummary.ts
 *
 * Frontend helper that requests a cached AI prose summary for an incident and
 * writes it back to incidents.ai_summary. Designed to be fired NON-BLOCKING
 * after a successful save so the user never waits on the LLM round-trip.
 *
 * The summarize action lives in the ai-assist edge function (which holds the
 * provider key); see supabase/functions/server/ai-assist.tsx. This module only
 * forwards the incident snapshot and persists the result.
 */

import { supabase } from './supabase';
import { projectId, publicAnonKey } from '../../../utils/supabase/info';

const EDGE_URL = `https://${projectId}.supabase.co/functions/v1/make-server-64775d98/ai-assist`;

/** Minimal shape the summarize action reads. Extra keys are ignored. */
export interface SummarizableIncident {
  incident_description?: string | null;
  investigation?: string | null;
  root_cause?: string | null;
  notes?: string | null;
  event_category?: string | null;
  incident_severity?: string | null;
  failed_component_label?: string | null;
  failure_type_label?: string | null;
  well_name?: string | null;
  ['stage#']?: string | null;
  stage_number?: string | null;
  xc_caused?: string | null;
  vendor_caused?: string | null;
  incident_status?: string | null;
  [key: string]: unknown;
}

/** True when there's enough source text to bother summarizing. */
export function hasSummarizableText(inc: SummarizableIncident): boolean {
  return Boolean(
    (inc.incident_description && String(inc.incident_description).trim()) ||
    (inc.investigation && String(inc.investigation).trim()) ||
    (inc.root_cause && String(inc.root_cause).trim()) ||
    (inc.notes && String(inc.notes).trim())
  );
}

/**
 * Call the edge summarize action and return the prose summary (or null on any
 * failure). Forwards the live session token; the route requires a signed-in
 * user because it calls a paid provider API.
 */
export async function generateIncidentSummary(
  incident: SummarizableIncident,
): Promise<string | null> {
  if (!hasSummarizableText(incident)) return null;

  // The edge builder reads `stage#`; mirror stage_number into it if needed.
  const payloadIncident: Record<string, unknown> = { ...incident };
  if (payloadIncident['stage#'] == null && incident.stage_number != null) {
    payloadIncident['stage#'] = incident.stage_number;
  }

  let token = publicAnonKey;
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) token = data.session.access_token;
  } catch {
    /* fall back to anon */
  }

  try {
    const res = await fetch(EDGE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'summarize', incident: payloadIncident }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.warn('summarize failed:', data?.error || res.status);
      return null;
    }
    const result = typeof data?.result === 'string' ? data.result.trim() : '';
    return result || null;
  } catch (err: any) {
    console.warn('summarize request error:', err?.message || err);
    return null;
  }
}

/**
 * Generate a summary and persist it to incidents.ai_summary for the given row.
 * Non-blocking by design: callers fire-and-forget after a successful save.
 * Returns the summary written, or null if nothing was generated/saved.
 */
export async function generateAndStoreIncidentSummary(
  rowId: string,
  incident: SummarizableIncident,
): Promise<string | null> {
  if (!rowId) return null;
  const summary = await generateIncidentSummary(incident);
  if (!summary) return null;
  const { error } = await supabase
    .from('incidents')
    .update({ ai_summary: summary })
    .eq('row_id', rowId);
  if (error) {
    console.warn('failed to persist ai_summary:', error.message);
    return null;
  }
  return summary;
}
