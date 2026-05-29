import { publicAnonKey } from '/utils/supabase/info';
import {
  buildAuthHeader,
  buildUserAuthHeader,
} from './authHeader.core';

export { buildAuthHeader, buildUserAuthHeader };

// Build the Authorization header value for calls to the Edge Function API.
// Protected endpoints (deletes and other admin operations) require a real
// user JWT — never the public anon key. When the user is signed in we pass
// their access token; for unauthenticated public reads we fall back to the
// anon key so Supabase's API gateway lets the request reach the function.
export function authHeader(accessToken: string | null | undefined) {
  return buildAuthHeader(accessToken, publicAnonKey);
}

// Variant that refuses to fall back to the anon key. Use this for calls
// that must be authenticated (e.g. DELETEs). Returns null when there is no
// signed-in user, so callers can short-circuit instead of accidentally
// hitting the backend with the anon key.
export function userAuthHeader(accessToken: string | null | undefined) {
  return buildUserAuthHeader(accessToken);
}
