import { parseJsonBody } from "../../../../_lib/validation";
import { json } from "../../../../_lib/http";
import { processOutboxByIdBackground } from "../../../../_lib/email/outbox";
import { requestAdminSignInLink } from "../../../../_lib/services/admin-auth-flow";
import { logInfo } from "../../../../_lib/logging";
import { adminAuthRequestSchema } from "../../../../../assets/shared/schemas/admin-auth";
import type { AdminContext } from "../../../../_lib/db/context";
import { prepareMagicLinkRequestHttp } from "../../../../_lib/auth/http-flow";
import { dispatchPostOnly } from "../../../../_lib/http";

const ADMIN_MAGIC_LINK_REQUEST_RATE_LIMIT_NAMESPACE = "admin-auth-request-link";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const body = await parseJsonBody(c.req, adminAuthRequestSchema);
  const http = await prepareMagicLinkRequestHttp(c, body.email, ADMIN_MAGIC_LINK_REQUEST_RATE_LIMIT_NAMESPACE);

  const result = await requestAdminSignInLink(http.db, {
    email: body.email,
    ipHash: http.ipHash,
    userAgentHash: http.userAgentHash,
    ttlMinutes: http.magicLinkTtlMinutes,
    appBaseUrl: http.appBaseUrl,
    signingSecret: http.secret,
  });

  if (result.outboxId) {
    c.executionCtx.waitUntil(processOutboxByIdBackground(http.db, c.env, result.outboxId));
  } else {
    logInfo("admin_magic_link_skipped", {
      reason:
        "No active admin user found for the requested email address. " +
        "Check that the user exists in the database with role='admin' and active=1.",
    });
  }

  return json({ success: true });
}

export async function onRequest(c: AdminContext): Promise<Response> {
  return dispatchPostOnly(c, onRequestPost);
}
