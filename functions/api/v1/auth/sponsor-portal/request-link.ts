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
import { queueSponsorPortalSignInCapabilityForEmail } from "../../../../_lib/auth/sponsor-portal";
import { processOutboxByIdBackground, queueEmail } from "../../../../_lib/email/outbox";
import { logInfo } from "../../../../_lib/logging";
import { sponsorPortalAuthRequestSchema } from "../../../../../assets/shared/schemas/sponsor-portal";
import type { AdminContext } from "../../../../_lib/db/context";
import { prepareMagicLinkRequestHttp } from "../../../../_lib/auth/http-flow";
import { dispatchPostOnly } from "../../../../_lib/http";
import { escapeMarkdownText } from "../../../../_lib/email/markdown";

const SPONSOR_MAGIC_LINK_REQUEST_RATE_LIMIT_NAMESPACE = "sponsor-portal-auth-request-link";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const body = await parseJsonBody(c.req, sponsorPortalAuthRequestSchema);
  const http = await prepareMagicLinkRequestHttp(c, body.email, SPONSOR_MAGIC_LINK_REQUEST_RATE_LIMIT_NAMESPACE);

  const magic = await queueSponsorPortalSignInCapabilityForEmail(http.db, {
    email: body.email,
    eventId: body.eventId,
    ipHash: http.ipHash,
    userAgentHash: http.userAgentHash,
    ttlMinutes: http.magicLinkTtlMinutes,
    signingSecret: http.secret,
  });

  if (magic.queuedToken && magic.sponsorship) {
    const portalUrl = `${http.appBaseUrl}/sponsor-portal/?token=${encodeURIComponent(magic.queuedToken)}`;
    const outboxId = await queueEmail(http.db, {
      templateKey: "sponsor-portal-access",
      recipientEmail: magic.sponsorship.contactEmail,
      messageType: "transactional",
      subject: "Access your sponsor portal",
      data: {
        contactNameText: escapeMarkdownText(magic.sponsorship.contactEmail),
        tierText: escapeMarkdownText(magic.sponsorship.tier),
        eventNameText: "",
        portalUrl,
        expiresInMinutes: http.magicLinkTtlMinutes,
      },
      capabilityLinkValues: [portalUrl],
    });
    c.executionCtx.waitUntil(processOutboxByIdBackground(http.db, c.env, outboxId));
  } else {
    logInfo("sponsor_portal_magic_link_skipped", {
      reason: "No active event sponsorship found for the requested email/event.",
    });
  }

  return json({ success: true });
}

export async function onRequest(c: AdminContext): Promise<Response> {
  return dispatchPostOnly(c, onRequestPost);
}
