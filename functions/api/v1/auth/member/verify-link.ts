/**
 * POST /api/v1/auth/member/verify-link.
 * Mirrors admin/auth/verify-link.ts, issuing a member session instead of an
 * admin session (see functions/_lib/auth/member.ts). Member sessions are
 * long-lived (default 720h / 30 days) since members aren't expected to
 * re-authenticate every few hours the way staff sessions do.
 */
import { parseJsonBody } from "../../../../_lib/validation";
import { json } from "../../../../_lib/http";
import {
  serializeMemberSessionCookie,
  signMemberSessionToken,
  verifyMemberMagicLink,
} from "../../../../_lib/auth/member";
import { getClientIp, getUserAgent, hashOptional, requireInternalSecret } from "../../../../_lib/request";
import { enforceRateLimit } from "../../../../_lib/rate-limit";
import { memberAuthVerifySchema } from "../../../../../assets/shared/schemas/member-auth";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";

const DEFAULT_MEMBER_SESSION_TTL_HOURS = 720;

function memberSessionTtlHours(env: { MEMBER_SESSION_TTL_HOURS?: string }): number {
  const parsed = Number.parseInt(env.MEMBER_SESSION_TTL_HOURS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MEMBER_SESSION_TTL_HOURS;
}

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const body = await parseJsonBody(c.req, memberAuthVerifySchema);
  const secret = requireInternalSecret(c.env);
  const clientIp = getClientIp(c.req.raw);
  await enforceRateLimit({ binding: c.env.IP_RATE_LIMITER, namespace: "member-auth-verify-link:ip", key: clientIp });

  const [ipHash, userAgentHash] = await Promise.all([
    hashOptional(clientIp, secret),
    hashOptional(getUserAgent(c.req.raw), secret),
  ]);

  const verified = await verifyMemberMagicLink(requestDb(c), {
    token: body.token,
    sessionTtlHours: memberSessionTtlHours(c.env),
    ipHash,
    userAgentHash,
  });

  const token = await signMemberSessionToken(secret, {
    userId: verified.member.userId,
    sessionId: verified.sessionId,
    expiresAt: verified.expiresAt,
  });

  const response = json({ success: true, expiresAt: verified.expiresAt, member: verified.member });
  response.headers.append("Set-Cookie", serializeMemberSessionCookie(token, c.req.raw));
  return response;
}

export async function onRequest(c: AdminContext): Promise<Response> {
  if (c.req.raw.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestPost(c);
}
