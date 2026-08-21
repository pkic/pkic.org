/**
 * POST /api/v1/sponsor-portal/logout.
 *
 * Lives under /api/v1/sponsor-portal (not alongside request-link/verify-link
 * in /api/v1/auth/sponsor-portal) because the session cookie's own `Path`
 * is deliberately scoped to SPONSOR_PORTAL_SESSION_COOKIE_PATH
 * ("/api/v1/sponsor-portal") — a route outside that prefix would never
 * actually receive the cookie from a real browser, only from a test that
 * sets the Cookie header manually. Otherwise mirrors auth/member/logout.ts:
 * revokes the session server-side (if the cookie is present and valid) and
 * clears the cookie either way.
 */
import {
  getSponsorPortalSessionCookieToken,
  revokeSponsorPortalSession,
  serializeExpiredSponsorPortalSessionCookie,
  verifySponsorPortalSessionToken,
} from "../../../_lib/auth/sponsor-portal";
import type { AdminContext } from "../../../_lib/db/context";
import { logoutSession, type SessionLogoutPolicy } from "../../../_lib/auth/http-flow";
import { dispatchPostOnly } from "../../../_lib/http";

const SPONSOR_PORTAL_LOGOUT_POLICY = {
  readCookie: getSponsorPortalSessionCookieToken,
  verify: verifySponsorPortalSessionToken,
  revoke: revokeSponsorPortalSession,
  serializeExpiredCookie: serializeExpiredSponsorPortalSessionCookie,
} satisfies SessionLogoutPolicy;

export async function onRequestPost(c: AdminContext): Promise<Response> {
  return logoutSession(c, SPONSOR_PORTAL_LOGOUT_POLICY);
}

export async function onRequest(c: AdminContext): Promise<Response> {
  return dispatchPostOnly(c, onRequestPost);
}
