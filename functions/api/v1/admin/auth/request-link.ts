import { parseJsonBody } from "../../../../_lib/validation";
import { json } from "../../../../_lib/http";
import { requestAdminMagicLink } from "../../../../_lib/auth/admin";
import { getConfig, resolveAppBaseUrl } from "../../../../_lib/config";
import { getClientIp, getUserAgent, hashOptional, requireInternalSecret } from "../../../../_lib/request";
import { enforceRateLimit } from "../../../../_lib/rate-limit";
import { processOutboxByIdBackground, queueEmail } from "../../../../_lib/email/outbox";
import { writeAuditLog } from "../../../../_lib/services/audit";
import { logInfo } from "../../../../_lib/logging";
import { adminAuthRequestSchema } from "../../../../../assets/shared/schemas/api";

export async function onRequestPost(c: any): Promise<Response> {
  const body = await parseJsonBody(c.req, adminAuthRequestSchema);
  const clientIp = getClientIp(c.req.raw);
  await enforceRateLimit({
    binding: c.env.EMAIL_RATE_LIMITER,
    namespace: "admin-auth-request-link:email",
    key: body.email,
  });
  await enforceRateLimit({
    binding: c.env.IP_RATE_LIMITER,
    namespace: "admin-auth-request-link:ip",
    key: clientIp,
  });

  const config = getConfig(c.env, c.req.raw);
  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);

  const secret = requireInternalSecret(c.env);
  const ipHash = await hashOptional(clientIp, secret);
  const userAgentHash = await hashOptional(getUserAgent(c.req.raw), secret);

  const magic = await requestAdminMagicLink(c.env.DB, {
    email: body.email,
    ipHash,
    userAgentHash,
    ttlMinutes: config.magicLinkTtlMinutes,
  });

  if (magic.token && magic.admin) {
    const magicLinkUrl = `${appBaseUrl}/admin/?token=${encodeURIComponent(magic.token)}`;
    const outboxId = await queueEmail(c.env.DB, {
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

    c.executionCtx.waitUntil(processOutboxByIdBackground(c.env.DB, c.env, outboxId));

    await writeAuditLog(
      c.env.DB,
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

export async function onRequest(c: any): Promise<Response> {
  if (c.req.raw.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestPost(c);
}
