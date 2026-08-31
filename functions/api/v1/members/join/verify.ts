import {
  memberJoinVerifyResponseSchema,
  memberJoinVerifyRouteSchema,
} from "../../../../../assets/shared/schemas/member-join";
import { createSessionEstablishedResponse, prepareMagicLinkVerificationHttp } from "../../../../_lib/auth/http-flow";
import { findEligibleMemberById } from "../../../../_lib/auth/member";
import { serializeUserSessionCookie, signUserSessionToken } from "../../../../_lib/auth/user-session";
import { sessionExpiresAtToExp } from "../../../../_lib/auth/session-engine";
import { resolveMemberSessionTtlHours } from "../../../../_lib/auth/session-policy";
import { AppError } from "../../../../_lib/errors";
import { jsonPrivate } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { verifyMemberJoin } from "../../../../_lib/services/membership/join/verify";
import type { AdminContext } from "../../../../_lib/db/context";

const RATE_LIMIT_NAMESPACE = "membership-join-verify:ip";

export const MembersJoinVerifyPost = openApiRoute(memberJoinVerifyRouteSchema, async (c: AdminContext, data) => {
  const http = await prepareMagicLinkVerificationHttp(c, RATE_LIMIT_NAMESPACE);
  const result = await verifyMemberJoin(http.db, {
    token: data.body.token,
    signingSecret: http.secret,
    applicationTtlSeconds: 15 * 60,
    sessionTtlHours: resolveMemberSessionTtlHours(c.env.MEMBER_SESSION_TTL_HOURS),
  });
  if (result.status !== "organization_session_ready") {
    return jsonPrivate(memberJoinVerifyResponseSchema.parse(result));
  }

  const member = await findEligibleMemberById(http.db, result.userId, result.identityId);
  if (!member) throw new AppError(500, "MEMBER_JOIN_SESSION_FAILED", "Member portal access could not be established");
  const body = memberJoinVerifyResponseSchema.parse({
    status: "organization_access_ready",
    expiresAt: result.expiresAt,
    member: { ...member, sessionId: result.sessionId, expiresAt: result.expiresAt },
  });
  const token = await signUserSessionToken(http.secret, {
    sub: result.userId,
    sid: result.sessionId,
    exp: sessionExpiresAtToExp(result.expiresAt),
    identityId: result.identityId,
  });
  return createSessionEstablishedResponse(body, serializeUserSessionCookie(token, c.req.raw));
});
