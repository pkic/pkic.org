import {
  memberJoinVerifyResponseSchema,
  memberJoinVerifyRouteSchema,
} from "../../../../../assets/shared/schemas/member-join";
import {
  getUserSessionCookieToken,
  refreshUserSessionFromRequest,
  resolveUserSessionFromRequest,
  serializeUserSessionCookie,
  USER_SESSION_TOKEN_HEADER,
} from "../../../../_lib/auth/user-session";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { refuseIneligibleWorkEmail } from "../../../../_lib/email-domains/work-email-screen";
import { jsonPrivate } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { enforceRateLimit } from "../../../../_lib/rate-limit";
import { getClientIp, requireInternalSecret } from "../../../../_lib/request";
import { verifyMemberJoin } from "../../../../_lib/services/membership/join/verify";
import { normalizeEmail } from "../../../../_lib/validation";

const RATE_LIMIT_NAMESPACE = "membership-join-verify:ip";

export const MembersJoinVerifyPost = openApiRoute(memberJoinVerifyRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const session = await resolveUserSessionFromRequest(db, c.req.raw, c.env);
  await enforceRateLimit({
    binding: c.env.IP_RATE_LIMITER,
    namespace: RATE_LIMIT_NAMESPACE,
    key: getClientIp(c.req.raw),
  });
  const email = normalizeEmail(session.identity.email);
  // The same work-email rule the sign-in card applies: a personal mailbox joins only as an individual.
  refuseIneligibleWorkEmail({ email, unaffiliatedAttestation: data.body.unaffiliatedAttestation });
  const result = await verifyMemberJoin(db, {
    userId: session.identity.id,
    email,
    applicantKind: data.body.unaffiliatedAttestation ? "individual" : "organization",
    organizationId: data.body.organizationId,
    organizationName: data.body.organizationName,
    domain: data.body.domain,
    continueAsIndividual: data.body.continueAsIndividual,
    signingSecret: requireInternalSecret(c.env),
    applicationTtlSeconds: 15 * 60,
  });
  if (result.status !== "organization_identity_ready") {
    return jsonPrivate(memberJoinVerifyResponseSchema.parse(result));
  }

  // The person now represents the member organization, so their session continues as that representation.
  const { token } = await refreshUserSessionFromRequest(db, c.req.raw, c.env, {
    actingIdentityId: result.identityId,
  });
  const response = jsonPrivate(memberJoinVerifyResponseSchema.parse({ status: "organization_access_ready" }));
  if (getUserSessionCookieToken(c.req.raw)) {
    response.headers.append("Set-Cookie", serializeUserSessionCookie(token, c.req.raw));
  } else {
    response.headers.set(USER_SESSION_TOKEN_HEADER, token);
  }
  return response;
});
