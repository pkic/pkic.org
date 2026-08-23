import { parseCookieHeader } from "./session-engine";

export const ADMIN_SESSION_COOKIE_NAME = "pkic_admin_session";
export const ADMIN_SESSION_COOKIE_PATH = "/api/v1";

export const MEMBER_SESSION_COOKIE_NAME = "pkic_member_session";
export const MEMBER_SESSION_COOKIE_PATH = "/api/v1";

export const SPONSOR_PORTAL_SESSION_COOKIE_NAME = "pkic_sponsor_portal_session";
export const SPONSOR_PORTAL_SESSION_COOKIE_PATH = "/api/v1/sponsor-portal";

const AUTHENTICATED_SESSION_COOKIE_NAMES = new Set([
  ADMIN_SESSION_COOKIE_NAME,
  MEMBER_SESSION_COOKIE_NAME,
  SPONSOR_PORTAL_SESSION_COOKIE_NAME,
]);

/** True when the request carries one of the application's authenticated session cookies. */
export function hasAuthenticatedSessionCookie(request: Request): boolean {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return false;
  for (const cookieName of parseCookieHeader(cookieHeader).keys()) {
    if (AUTHENTICATED_SESSION_COOKIE_NAMES.has(cookieName)) return true;
  }
  return false;
}
