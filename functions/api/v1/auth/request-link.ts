import { processOutboxByIdBackground } from "../../../_lib/email/outbox";
import { json } from "../../../_lib/http";
import { logInfo } from "../../../_lib/logging";
import { prepareMagicLinkRequestHttp, USER_EMAIL_LINK_RATE_LIMIT_NAMESPACE } from "../../../_lib/auth/http-flow";
import { portalVerifyLinkBase, requestUserSignInLink } from "../../../_lib/services/user-auth-flow";
import { openApiRoute } from "../../../_lib/openapi/route";
import type { AdminContext } from "../../../_lib/db/context";
import { userAuthRequestRouteSchema } from "../../../../assets/shared/schemas/user-auth";

export const UserAuthRequestLink = openApiRoute(userAuthRequestRouteSchema, async (c: AdminContext, data) => {
  const http = await prepareMagicLinkRequestHttp(c, data.body.email, USER_EMAIL_LINK_RATE_LIMIT_NAMESPACE);
  const result = await requestUserSignInLink(
    http.db,
    {
      email: data.body.email,
      ipHash: http.ipHash,
      userAgentHash: http.userAgentHash,
      ttlMinutes: http.magicLinkTtlMinutes,
      signingSecret: http.secret,
      magicLinkBaseUrl: portalVerifyLinkBase(http.appBaseUrl, data.body.returnPath),
    },
    undefined,
    // An address without an account is told so, with the way back to start one where the person was going.
    `${http.appBaseUrl}${data.body.returnPath ?? "/portal/"}`,
  );

  if (!result.outboxId) {
    logInfo("user_magic_link_skipped", { reason: "No active user capacity found for the requested email address." });
    return json({ success: true });
  }

  c.executionCtx.waitUntil(processOutboxByIdBackground(http.db, c.env, result.outboxId));
  return json({ success: true });
});
