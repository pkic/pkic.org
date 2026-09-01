import { prepareMagicLinkVerificationHttp, createSessionEstablishedResponse } from "../../../_lib/auth/http-flow";
import {
  redeemSponsorSignInCapability,
  redeemUserSignInCapability,
  serializeUserSessionCookie,
} from "../../../_lib/auth/user-session";
import { parseCapabilityToken } from "../../../_lib/auth/capability-token";
import { openApiRoute } from "../../../_lib/openapi/route";
import type { AdminContext } from "../../../_lib/db/context";
import {
  userAuthEstablishedResponseSchema,
  userAuthVerifyRouteSchema,
} from "../../../../assets/shared/schemas/user-auth";
import { resolveMemberSessionTtlHours } from "../../../_lib/auth/session-policy";

const USER_MAGIC_LINK_VERIFY_RATE_LIMIT_NAMESPACE = "user-auth-verify-link:ip";

export const UserAuthVerifyLink = openApiRoute(userAuthVerifyRouteSchema, async (c: AdminContext, data) => {
  const http = await prepareMagicLinkVerificationHttp(c, USER_MAGIC_LINK_VERIFY_RATE_LIMIT_NAMESPACE);
  const redeem = parseCapabilityToken(data.body.token, "sponsor_sign_in")
    ? redeemSponsorSignInCapability
    : redeemUserSignInCapability;
  const result = await redeem(http.db, {
    token: data.body.token,
    signingSecret: http.secret,
    sessionTtlHours: resolveMemberSessionTtlHours(c.env.MEMBER_SESSION_TTL_HOURS),
    ipHash: http.ipHash,
    userAgentHash: http.userAgentHash,
  });
  const response = createSessionEstablishedResponse(
    userAuthEstablishedResponseSchema.parse({
      success: true,
      expiresAt: result.session.expiresAt,
      identity: result.session.identity,
      ...(result.session.staff ? { staff: result.session.staff } : {}),
      ...(result.session.member ? { member: result.session.member } : {}),
      sponsors: result.session.sponsors,
      pendingIdentityCount: result.session.pendingIdentityCount,
    }),
    serializeUserSessionCookie(result.token, c.req.raw),
  );
  return response;
});
