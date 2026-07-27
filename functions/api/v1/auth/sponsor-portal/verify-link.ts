/**
 * POST /api/v1/auth/sponsor-portal/verify-link — PRD §4.13.
 * Mirrors auth/member/verify-link.ts, issuing a sponsor-portal session
 * instead of a member session (see _lib/auth/sponsor-portal.ts).
 */
import { parseJsonBody } from "../../../../_lib/validation";
import { json } from "../../../../_lib/http";
import {
  serializeSponsorPortalSessionCookie,
  signSponsorPortalSessionToken,
  verifySponsorPortalMagicLink,
} from "../../../../_lib/auth/sponsor-portal";
import { getClientIp, getUserAgent, hashOptional, requireInternalSecret } from "../../../../_lib/request";
import { enforceRateLimit } from "../../../../_lib/rate-limit";
import { sponsorPortalAuthVerifySchema } from "../../../../../assets/shared/schemas/sponsor-portal";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";

const DEFAULT_SPONSOR_PORTAL_SESSION_TTL_HOURS = 72;

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const body = await parseJsonBody(c.req, sponsorPortalAuthVerifySchema);
  const secret = requireInternalSecret(c.env);
  const clientIp = getClientIp(c.req.raw);
  await enforceRateLimit({
    binding: c.env.IP_RATE_LIMITER,
    namespace: "sponsor-portal-auth-verify-link:ip",
    key: clientIp,
  });

  const [ipHash, userAgentHash] = await Promise.all([
    hashOptional(clientIp, secret),
    hashOptional(getUserAgent(c.req.raw), secret),
  ]);

  const verified = await verifySponsorPortalMagicLink(requestDb(c), {
    token: body.token,
    sessionTtlHours: DEFAULT_SPONSOR_PORTAL_SESSION_TTL_HOURS,
    ipHash,
    userAgentHash,
  });

  const token = await signSponsorPortalSessionToken(secret, {
    sponsorshipId: verified.session.sponsorshipId,
    sessionId: verified.sessionId,
    expiresAt: verified.expiresAt,
  });

  const response = json({ success: true, expiresAt: verified.expiresAt, sponsorship: verified.session });
  response.headers.append("Set-Cookie", serializeSponsorPortalSessionCookie(token, c.req.raw));
  return response;
}

export async function onRequest(c: AdminContext): Promise<Response> {
  if (c.req.raw.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestPost(c);
}
