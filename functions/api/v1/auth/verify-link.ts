import { publicUserSession } from "../../../_lib/auth/public-user-session";
import { prepareMagicLinkVerificationHttp, createSessionEstablishedResponse } from "../../../_lib/auth/http-flow";
import { redeemUserSignInCapability, serializeUserSessionCookie } from "../../../_lib/auth/user-session";
import { redeemSponsorSignInCapability } from "../../../_lib/auth/sponsor-sign-in-session";
import { redeemUserSignUpCapability } from "../../../_lib/auth/user-sign-up";
import { parseCapabilityToken } from "../../../_lib/auth/capability-token";
import { openApiRoute } from "../../../_lib/openapi/route";
import { jsonPrivate } from "../../../_lib/http";
import { accountOrganizationRequiredSchema } from "../../../../assets/shared/schemas/account-organization";
import type { AdminContext } from "../../../_lib/db/context";
import {
  userAuthEstablishedResponseSchema,
  userAuthVerifyRouteSchema,
} from "../../../../assets/shared/schemas/user-auth";
import { resolveMemberSessionTtlHours } from "../../../_lib/auth/session-policy";

const USER_MAGIC_LINK_VERIFY_RATE_LIMIT_NAMESPACE = "user-auth-verify-link:ip";

export const UserAuthVerifyLink = openApiRoute(userAuthVerifyRouteSchema, async (c: AdminContext, data) => {
  const http = await prepareMagicLinkVerificationHttp(c, USER_MAGIC_LINK_VERIFY_RATE_LIMIT_NAMESPACE);
  const redemption = {
    token: data.body.token,
    signingSecret: http.secret,
    sessionTtlHours: resolveMemberSessionTtlHours(c.env.MEMBER_SESSION_TTL_HOURS),
    ipHash: http.ipHash,
    userAgentHash: http.userAgentHash,
  };
  const organization = { affiliation: data.body.affiliation, answer: data.body.organization };
  const result = parseCapabilityToken(data.body.token, "sponsor_sign_in")
    ? await redeemSponsorSignInCapability(http.db, { ...redemption, organization })
    : parseCapabilityToken(data.body.token, "user_sign_up")
      ? await redeemUserSignUpCapability(http.db, { ...redemption, organization })
      : await redeemUserSignInCapability(http.db, { ...redemption, organization });
  // No session until the organization step is answered; the same link answers it.
  if ("required" in result) return jsonPrivate(accountOrganizationRequiredSchema.parse(result.required));
  const response = createSessionEstablishedResponse(
    userAuthEstablishedResponseSchema.parse({
      success: true,
      ...(await publicUserSession(http.db, result.session)),
    }),
    serializeUserSessionCookie(result.token, c.req.raw),
  );
  return response;
});
