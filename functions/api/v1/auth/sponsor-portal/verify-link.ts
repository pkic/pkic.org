/**
 * POST /api/v1/auth/sponsor-portal/verify-link.
 * Mirrors auth/member/verify-link.ts, issuing a sponsor-portal session
 * instead of a member session (see _lib/auth/sponsor-portal.ts).
 */
import { parseJsonBody } from "../../../../_lib/validation";
import {
  serializeSponsorPortalSessionCookie,
  signSponsorPortalSessionToken,
  redeemSponsorPortalSignInCapability,
} from "../../../../_lib/auth/sponsor-portal";
import { sponsorPortalAuthVerifySchema } from "../../../../../assets/shared/schemas/sponsor-portal";
import type { AdminContext } from "../../../../_lib/db/context";
import { createSessionEstablishedResponse, prepareMagicLinkVerificationHttp } from "../../../../_lib/auth/http-flow";
import { dispatchPostOnly } from "../../../../_lib/http";

const DEFAULT_SPONSOR_PORTAL_SESSION_TTL_HOURS = 72;
const SPONSOR_MAGIC_LINK_VERIFY_RATE_LIMIT_NAMESPACE = "sponsor-portal-auth-verify-link:ip";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const body = await parseJsonBody(c.req, sponsorPortalAuthVerifySchema);
  const http = await prepareMagicLinkVerificationHttp(c, SPONSOR_MAGIC_LINK_VERIFY_RATE_LIMIT_NAMESPACE);

  const verified = await redeemSponsorPortalSignInCapability(http.db, {
    token: body.token,
    signingSecret: http.secret,
    sessionTtlHours: DEFAULT_SPONSOR_PORTAL_SESSION_TTL_HOURS,
    ipHash: http.ipHash,
    userAgentHash: http.userAgentHash,
  });

  const token = await signSponsorPortalSessionToken(http.secret, {
    sponsorshipId: verified.session.sponsorshipId,
    sessionId: verified.sessionId,
    expiresAt: verified.expiresAt,
  });

  return createSessionEstablishedResponse(
    { success: true, expiresAt: verified.expiresAt, sponsorship: verified.session },
    serializeSponsorPortalSessionCookie(token, c.req.raw),
  );
}

export async function onRequest(c: AdminContext): Promise<Response> {
  return dispatchPostOnly(c, onRequestPost);
}
