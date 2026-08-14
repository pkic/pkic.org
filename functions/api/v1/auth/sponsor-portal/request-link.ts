/**
 * POST /api/v1/auth/sponsor-portal/request-link.
 * Mirrors auth/member/request-link.ts, targeting an active event
 * sponsorship's contact email instead of a member (see
 * _lib/auth/sponsor-portal.ts). Used for re-requesting a link after the
 * initial sponsor-portal-access email (sent automatically when the
 * sponsorship first goes active — see admin/sponsorships/[id]/stage.ts)
 * expires.
 */
import { parseJsonBody } from "../../../../_lib/validation";
import { json } from "../../../../_lib/http";
import { requestSponsorPortalMagicLink } from "../../../../_lib/auth/sponsor-portal";
import { getConfig, resolveAppBaseUrl } from "../../../../_lib/config";
import { getClientIp, getUserAgent, hashOptional, requireInternalSecret } from "../../../../_lib/request";
import { enforceRateLimit } from "../../../../_lib/rate-limit";
import { processOutboxByIdBackground, queueEmail } from "../../../../_lib/email/outbox";
import { logInfo } from "../../../../_lib/logging";
import { sponsorPortalAuthRequestSchema } from "../../../../../assets/shared/schemas/sponsor-portal";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const body = await parseJsonBody(c.req, sponsorPortalAuthRequestSchema);
  const clientIp = getClientIp(c.req.raw);
  await enforceRateLimit({
    binding: c.env.EMAIL_RATE_LIMITER,
    namespace: "sponsor-portal-auth-request-link:email",
    key: body.email,
  });
  await enforceRateLimit({
    binding: c.env.IP_RATE_LIMITER,
    namespace: "sponsor-portal-auth-request-link:ip",
    key: clientIp,
  });

  const config = getConfig(c.env, c.req.raw);
  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
  const secret = requireInternalSecret(c.env);
  const ipHash = await hashOptional(clientIp, secret);
  const userAgentHash = await hashOptional(getUserAgent(c.req.raw), secret);

  const magic = await requestSponsorPortalMagicLink(requestDb(c), {
    email: body.email,
    eventId: body.eventId,
    ipHash,
    userAgentHash,
    ttlMinutes: config.magicLinkTtlMinutes,
  });

  if (magic.token && magic.sponsorship) {
    const portalUrl = `${appBaseUrl}/sponsor-portal/?token=${encodeURIComponent(magic.token)}`;
    const outboxId = await queueEmail(requestDb(c), {
      templateKey: "sponsor-portal-access",
      recipientEmail: magic.sponsorship.contactEmail,
      messageType: "transactional",
      subject: "Access your sponsor portal",
      data: {
        contactName: magic.sponsorship.contactEmail,
        tier: magic.sponsorship.tier,
        portalUrl,
        expiresInMinutes: config.magicLinkTtlMinutes,
      },
    });
    c.executionCtx.waitUntil(processOutboxByIdBackground(requestDb(c), c.env, outboxId));
  } else {
    logInfo("sponsor_portal_magic_link_skipped", {
      reason: "No active event sponsorship found for the requested email/event.",
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
