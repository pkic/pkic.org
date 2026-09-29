import { prepareMagicLinkRequestHttp } from "../../../_lib/auth/http-flow";
import { queueSponsorSignInCapabilityForEmail } from "../../../_lib/auth/sponsor-capacity";
import type { AdminContext } from "../../../_lib/db/context";
import { escapeMarkdownText } from "../../../_lib/email/markdown";
import { processOutboxByIdBackground, queueEmail } from "../../../_lib/email/outbox";
import { json } from "../../../_lib/http";
import { logInfo } from "../../../_lib/logging";
import { openApiRoute } from "../../../_lib/openapi/route";
import {
  sponsorAccessLinkCreateRouteSchema,
  sponsorAccessLinkRequestSchema,
} from "../../../../assets/shared/schemas/sponsor-access";
import type { z } from "zod";

const SPONSOR_ACCESS_LINK_RATE_LIMIT_NAMESPACE = "sponsor-access-links";

type SponsorAccessLinkRequest = z.infer<typeof sponsorAccessLinkRequestSchema>;

async function createSponsorAccessLink(c: AdminContext, body: SponsorAccessLinkRequest): Promise<Response> {
  const http = await prepareMagicLinkRequestHttp(c, body.email, SPONSOR_ACCESS_LINK_RATE_LIMIT_NAMESPACE);
  const capability = await queueSponsorSignInCapabilityForEmail(http.db, {
    email: body.email,
    eventId: body.eventSlug,
    ipHash: http.ipHash,
    userAgentHash: http.userAgentHash,
    ttlMinutes: http.magicLinkTtlMinutes,
    signingSecret: http.secret,
  });

  if (capability.queuedToken && capability.sponsorship) {
    const portalUrl = `${http.appBaseUrl}/portal/#/verify?token=${encodeURIComponent(capability.queuedToken)}`;
    const outboxId = await queueEmail(http.db, {
      templateKey: "sponsor-portal-access",
      recipientEmail: capability.sponsorship.contactEmail,
      messageType: "transactional",
      subject: "Access your sponsor workspace",
      data: {
        contactNameText: escapeMarkdownText(capability.sponsorship.contactEmail),
        tierText: escapeMarkdownText(capability.sponsorship.tier),
        eventNameText: escapeMarkdownText(capability.sponsorship.eventName ?? ""),
        portalUrl,
        expiresInMinutes: http.magicLinkTtlMinutes,
      },
      capabilityLinkValues: [portalUrl],
    });
    c.executionCtx.waitUntil(processOutboxByIdBackground(http.db, c.env, outboxId));
  } else {
    logInfo("sponsor_access_link_skipped", {
      reason: "No active event sponsorship found for the requested email/event.",
    });
  }

  return json({ success: true });
}

export const SponsorAccessLinksCreate = openApiRoute(sponsorAccessLinkCreateRouteSchema, (c: AdminContext, data) =>
  createSponsorAccessLink(c, data.body),
);
