import { processOutboxByIdBackground } from "../../../../_lib/email/outbox";
import { json } from "../../../../_lib/http";
import { logInfo } from "../../../../_lib/logging";
import { prepareMagicLinkRequestHttp } from "../../../../_lib/auth/http-flow";
import { requestPortalSignInLink } from "../../../../_lib/services/portal-auth-flow";
import { openApiRoute } from "../../../../_lib/openapi/route";
import type { AdminContext } from "../../../../_lib/db/context";
import { portalAuthRequestRouteSchema } from "../../../../../assets/shared/schemas/portal-auth";

const PORTAL_MAGIC_LINK_REQUEST_RATE_LIMIT_NAMESPACE = "portal-auth-request-link";

export const PortalAuthRequestLink = openApiRoute(portalAuthRequestRouteSchema, async (c: AdminContext, data) => {
  const http = await prepareMagicLinkRequestHttp(c, data.body.email, PORTAL_MAGIC_LINK_REQUEST_RATE_LIMIT_NAMESPACE);
  const result = await requestPortalSignInLink(http.db, {
    email: data.body.email,
    ipHash: http.ipHash,
    userAgentHash: http.userAgentHash,
    ttlMinutes: http.magicLinkTtlMinutes,
    appBaseUrl: http.appBaseUrl,
  });

  if (result.outboxId) {
    c.executionCtx.waitUntil(processOutboxByIdBackground(http.db, c.env, result.outboxId));
  } else {
    logInfo("portal_magic_link_skipped", { reason: "No active portal identity found for the primary email." });
  }
  return json({ success: true });
});
