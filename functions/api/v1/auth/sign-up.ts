import { processOutboxByIdBackground } from "../../../_lib/email/outbox";
import { json } from "../../../_lib/http";
import { prepareMagicLinkRequestHttp } from "../../../_lib/auth/http-flow";
import { portalVerifyLinkBase, requestUserSignUpLink } from "../../../_lib/services/user-auth-flow";
import { openApiRoute } from "../../../_lib/openapi/route";
import type { AdminContext } from "../../../_lib/db/context";
import { userSignUpRouteSchema } from "../../../../assets/shared/schemas/user-auth";

const USER_SIGN_UP_RATE_LIMIT_NAMESPACE = "user-auth-sign-up";

export const UserAuthSignUp = openApiRoute(userSignUpRouteSchema, async (c: AdminContext, data) => {
  const http = await prepareMagicLinkRequestHttp(c, data.body.email, USER_SIGN_UP_RATE_LIMIT_NAMESPACE);
  const result = await requestUserSignUpLink(http.db, {
    email: data.body.email,
    ipHash: http.ipHash,
    userAgentHash: http.userAgentHash,
    ttlMinutes: http.magicLinkTtlMinutes,
    signingSecret: http.secret,
    magicLinkBaseUrl: portalVerifyLinkBase(http.appBaseUrl, data.body.returnPath),
  });
  if (result.outboxId) c.executionCtx.waitUntil(processOutboxByIdBackground(http.db, c.env, result.outboxId));
  return json({ success: true });
});
