// Pure auth-header helpers with no module-level side effects, suitable for
// direct unit testing without bundler-specific imports.

export function buildAuthHeader(
  accessToken: string | null | undefined,
  anonKey: string,
): { Authorization: string } {
  const token = accessToken && accessToken.length > 0 ? accessToken : anonKey;
  return { Authorization: `Bearer ${token}` };
}

export function buildUserAuthHeader(
  accessToken: string | null | undefined,
): { Authorization: string } | null {
  if (!accessToken) return null;
  return { Authorization: `Bearer ${accessToken}` };
}
