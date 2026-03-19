import { parseJsonBody } from "../../../../_lib/validation";
import { json } from "../../../../_lib/http";
import { requestAdminMagicLink } from "../../../../_lib/auth/admin";
import { getConfig, resolveAppBaseUrl } from "../../../../_lib/config";
import { getClientIp, getUserAgent, hashOptional, requireInternalSecret } from "../../../../_lib/request";
import { processOutboxByIdBackground, queueEmail } from "../../../../_lib/email/outbox";
import { writeAuditLog } from "../../../../_lib/services/audit";
import { logInfo } from "../../../../_lib/logging";
import type { PagesContext } from "../../../../_lib/types";
import { adminAuthRequestSchema } from "../../../../../assets/shared/schemas/api";

export async function onRequestPost(context: PagesContext): Promise<Response> {
  const body = await parseJsonBody(context.request, adminAuthRequestSchema);
  const config = getConfig(context.env, context.request);
  const appBaseUrl = resolveAppBaseUrl(context.env);

  const secret = requireInternalSecret(context.env);
  const ipHash = await hashOptional(getClientIp(context.request), secret);
  const userAgentHash = await hashOptional(getUserAgent(context.request), secret);

  const magic = await requestAdminMagicLink(context.env.DB, {
    email: body.email,
    ipHash,
    userAgentHash,
    ttlMinutes: config.magicLinkTtlMinutes,
  });

  if (magic.token && magic.admin) {
    const magicLinkUrl = `${appBaseUrl}/admin/?token=${encodeURIComponent(magic.token)}`;
    const outboxId = await queueEmail(context.env.DB, {
      templateKey: "admin_magic_link",
      recipientEmail: magic.admin.email,
      recipientUserId: null,
      eventId: null,
      messageType: "transactional",
      subject: "Your PKI Consortium admin sign-in link",
      data: {
        email: magic.admin.email,
        magicLinkUrl,
        expiresInMinutes: config.magicLinkTtlMinutes,
      },
    });

    context.waitUntil(processOutboxByIdBackground(context.env.DB, context.env, outboxId));

    await writeAuditLog(
      context.env.DB,
      "admin",
      magic.admin.id,
      "admin_magic_link_requested",
      "admin_user",
      magic.admin.id,
      { email: magic.admin.email },
    );
  } else {
    logInfo("admin_magic_link_skipped", {
      reason: "No active admin user found for the requested email address. " +
        "Check that the user exists in the database with role='admin' and active=1.",
      email: body.email,
    });
  }

  return json({ success: true });
}

export async function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestPost(context);
}
