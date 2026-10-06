const DEFAULT_USER_MANAGEMENT_ORIGIN = "https://gestiondehotel.com";

const USER_MANAGEMENT_ALLOWED_ORIGINS = new Set([
  DEFAULT_USER_MANAGEMENT_ORIGIN,
  "https://www.gestiondehotel.com",
  "http://127.0.0.1:5500",
  "http://localhost:5500",
]);

export function isAllowedUserManagementOrigin(origin: string | null): boolean {
  return origin === null || USER_MANAGEMENT_ALLOWED_ORIGINS.has(origin);
}

export function buildUserManagementCorsHeaders(origin: string | null): Record<string, string> {
  const allowOrigin = origin && USER_MANAGEMENT_ALLOWED_ORIGINS.has(origin)
    ? origin
    : DEFAULT_USER_MANAGEMENT_ORIGIN;

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
