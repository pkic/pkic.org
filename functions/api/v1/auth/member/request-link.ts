/**
 * POST /api/v1/auth/member/request-link — PRD §4.9/§4.10.
 * Mirrors admin/auth/request-link.ts exactly, targeting active members
 * instead of staff (see functions/_lib/auth/member.ts).
 */
import { parseJsonBody } from "../../../../_lib/validation";
import { json } from "../../../../_lib/http";
import { requestMemberMagicLink } from "../../../../_lib/auth/member";
import { getConfig, resolveAppBaseUrl } from "../../../../_lib/config";
import { getClientIp, getUserAgent, hashOptional, requireInternalSecret } from "../../../../_lib/request";
import { enforceRateLimit } from "../../../../_lib/rate-limit";
import { processOutboxByIdBackground, queueEmail } from "../../../../_lib/email/outbox";
import { logInfo } from "../../../../_lib/logging";
import { memberAuthRequestSchema } from "../../../../../assets/shared/schemas/member-auth";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const body = await parseJsonBody(c.req, memberAuthRequestSchema);
  const clientIp = getClientIp(c.req.raw);
  await enforceRateLimit({
    binding: c.env.EMAIL_RATE_LIMITER,
    namespace: "member-auth-request-link:email",
    key: body.email,
  });
  await enforceRateLimit({ binding: c.env.IP_RATE_LIMITER, namespace: "member-auth-request-link:ip", key: clientIp });

  const config = getConfig(c.env, c.req.raw);
  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
  const secret = requireInternalSecret(c.env);
  const ipHash = await hashOptional(clientIp, secret);
  const userAgentHash = await hashOptional(getUserAgent(c.req.raw), secret);

  const magic = await requestMemberMagicLink(requestDb(c), {
    email: body.email,
    ipHash,
    userAgentHash,
    ttlMinutes: config.magicLinkTtlMinutes,
  });

  if (magic.token && magic.member) {
    const magicLinkUrl = `${appBaseUrl}/portal/?token=${encodeURIComponent(magic.token)}`;
    const outboxId = await queueEmail(requestDb(c), {
      templateKey: "member_magic_link",
      recipientEmail: magic.member.email,
      recipientUserId: null,
      messageType: "transactional",
      subject: "Your PKI Consortium member sign-in link",
      data: { email: magic.member.email, magicLinkUrl, expiresInMinutes: config.magicLinkTtlMinutes },
    });
    c.executionCtx.waitUntil(processOutboxByIdBackground(requestDb(c), c.env, outboxId));
  } else {
    logInfo("member_magic_link_skipped", {
      reason: "No active member found for the requested email address.",
    });
  }

  return json({ success: true });
}

export async function onRequest(c: AdminContext): Promise<Response> {
  if (c.req.raw.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestPost(c);
}
