import { publicAnonKey } from '/utils/supabase/info';
import { supabase } from './supabase';

/**
 * Resolve the Authorization header for an edge-function request.
 *
 * After the edge auth lockdown, the guarded data routes require a real user
 * token; the anon key is rejected with 401. This helper forwards the live
 * Supabase session access token and falls back to the anon key only when there
 * is no session (e.g. genuinely public endpoints like signin). Public routes
 * accept a real token too, so forwarding it everywhere is safe.
 *
 * @param extra optional additional headers to merge in (e.g. Content-Type)
 */
export async function getAuthHeaders(
  extra: Record<string, string> = {},
): Promise<Record<string, string>> {
  let token: string | undefined;
  try {
    const { data } = await supabase.auth.getSession();
    token = data.session?.access_token;
  } catch {
    // ignore — fall through to the anon key
  }
  return {
    Authorization: `Bearer ${token || publicAnonKey}`,
    ...extra,
  };
}

/** Bearer token string only (session token, or anon key fallback). */
export async function getBearerToken(): Promise<string> {
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) return data.session.access_token;
  } catch {
    // ignore
  }
  return publicAnonKey;
}
