import { createClient, type User } from "npm:@supabase/supabase-js@2.49.2";
import type { Context } from "npm:hono";

// Auth client using the project's anon key — used to validate user JWTs
// passed in the Authorization header. We never trust the anon key itself as
// a user identity; getUser(token) ensures the token corresponds to a real
// signed-in Supabase user.
const authClient = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_ANON_KEY") ?? "",
);

// Service-role client used for admin operations like listUsers().
const adminClient = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  { auth: { autoRefreshToken: false, persistSession: false } },
);

export type AuthedUser = User & { role: "admin" | "sqm" };

// Roles are stored on the Supabase auth user's user_metadata.role. We treat
// "admin" as the only privileged role; any other value (or missing) is
// downgraded to "sqm" (least privilege).
export function userRole(user: User): "admin" | "sqm" {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const appMeta = (user.app_metadata ?? {}) as Record<string, unknown>;
  const role = appMeta.role ?? meta.role;
  return role === "admin" ? "admin" : "sqm";
}

// Extract a bearer token from a request and resolve it to a Supabase auth
// user. Returns null if the header is missing, malformed, equal to the anon
// key, or the token does not correspond to a real signed-in user.
export async function getUserFromRequest(
  c: Context,
): Promise<AuthedUser | null> {
  const authHeader = c.req.header("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;

  // Reject the anon key as a user identity. The anon key is a JWT but
  // resolves to no user; getUser() returns an error, so this is also
  // defense-in-depth.
  if (token === (Deno.env.get("SUPABASE_ANON_KEY") ?? "")) return null;

  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data?.user) return null;

  return { ...data.user, role: userRole(data.user) } as AuthedUser;
}

// Hono middleware: 401 if no signed-in user, otherwise sets c.var.user.
export async function requireUser(c: Context, next: () => Promise<void>) {
  const user = await getUserFromRequest(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  c.set("user", user);
  await next();
}

// Hono middleware: 401 if no signed-in user, 403 if not an admin.
export async function requireAdmin(c: Context, next: () => Promise<void>) {
  const user = await getUserFromRequest(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  if (user.role !== "admin") return c.json({ error: "Forbidden" }, 403);
  c.set("user", user);
  await next();
}

// Returns true if at least one admin user exists in Supabase Auth. Used to
// gate the public /signup endpoint so that the very first admin can be
// bootstrapped, but no subsequent caller can self-promote to admin without
// already being one.
export async function adminExists(): Promise<boolean> {
  // Paginate through users; bail out as soon as an admin is seen.
  let page = 1;
  const perPage = 1000;
  // Safety cap so a misconfigured project can't loop forever.
  for (let i = 0; i < 50; i++) {
    const { data, error } = await adminClient.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) {
      console.error("adminExists: listUsers error", error.message);
      // Fail closed — treat unknown state as "an admin exists" so we never
      // accidentally allow public admin creation when we can't verify.
      return true;
    }
    const users = data?.users ?? [];
    if (users.some((u) => userRole(u) === "admin")) return true;
    if (users.length < perPage) return false;
    page += 1;
  }
  return true;
}
