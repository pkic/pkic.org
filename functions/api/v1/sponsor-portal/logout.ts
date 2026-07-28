/**
 * POST /api/v1/sponsor-portal/logout — PRD §4.13, §11 UI-7.
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
import { json } from "../../../_lib/http";
import { requestDb, type AdminContext } from "../../../_lib/db/context";
import { requireInternalSecret } from "../../../_lib/request";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const token = getSponsorPortalSessionCookieToken(c.req.raw);
  if (token) {
    const verified = await verifySponsorPortalSessionToken(requireInternalSecret(c.env), token);
    if (verified.ok) {
      await revokeSponsorPortalSession(requestDb(c), verified.claims.sid);
    }
  }

  const response = json({ success: true });
  response.headers.append("Set-Cookie", serializeExpiredSponsorPortalSessionCookie(c.req.raw));
  return response;
}

export async function onRequest(c: AdminContext): Promise<Response> {
  if (c.req.raw.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestPost(c);
}
