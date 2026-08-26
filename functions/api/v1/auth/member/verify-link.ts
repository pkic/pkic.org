/**
 * POST /api/v1/auth/member/verify-link.
 * Mirrors admin/auth/verify-link.ts, issuing a member session instead of an
 * admin session (see functions/_lib/auth/member.ts). Member sessions are
 * long-lived (default 720h / 30 days) since members aren't expected to
 * re-authenticate every few hours the way staff sessions do.
 */
import { parseJsonBody } from "../../../../_lib/validation";
import { redeemMemberSignInCapability } from "../../../../_lib/auth/member";
import { memberAuthVerifySchema } from "../../../../../assets/shared/schemas/member-auth";
import type { AdminContext } from "../../../../_lib/db/context";
import {
  createMemberSessionEstablishedResponse,
  prepareMagicLinkVerificationHttp,
} from "../../../../_lib/auth/http-flow";
import { dispatchPostOnly } from "../../../../_lib/http";
import { resolveMemberSessionTtlHours } from "../../../../_lib/auth/session-policy";

const MEMBER_MAGIC_LINK_VERIFY_RATE_LIMIT_NAMESPACE = "member-auth-verify-link:ip";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const body = await parseJsonBody(c.req, memberAuthVerifySchema);
  const http = await prepareMagicLinkVerificationHttp(c, MEMBER_MAGIC_LINK_VERIFY_RATE_LIMIT_NAMESPACE);

  const verified = await redeemMemberSignInCapability(http.db, {
    token: body.token,
    signingSecret: http.secret,
    sessionTtlHours: resolveMemberSessionTtlHours(c.env.MEMBER_SESSION_TTL_HOURS),
    ipHash: http.ipHash,
    userAgentHash: http.userAgentHash,
  });

  return createMemberSessionEstablishedResponse({
    secret: http.secret,
    request: c.req.raw,
    member: verified.member,
    sessionId: verified.sessionId,
    expiresAt: verified.expiresAt,
  });
}

export async function onRequest(c: AdminContext): Promise<Response> {
  return dispatchPostOnly(c, onRequestPost);
}
