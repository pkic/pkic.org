/**
 * POST /api/v1/sponsorship/inquiries
 *
 * Express interest without payment. This typed D1/outbox workflow is the
 * sole public consortium-sponsorship inquiry path.
 */
import { json } from "../../../_lib/http";
import { AppError } from "../../../_lib/errors";
import { resolveAppBaseUrl } from "../../../_lib/config";
import { enforceRateLimit } from "../../../_lib/rate-limit";
import { getClientIp } from "../../../_lib/request";
import { processOutboxByIdBackground } from "../../../_lib/email/outbox";
import { getEventBySlug } from "../../../_lib/services/events";
import {
  createSponsorshipInquiry,
  findOrganizationIdByName,
  isActiveSponsorshipTier,
  listActiveSponsorshipTierNames,
} from "../../../_lib/services/sponsorship";
import { sponsorshipInquiryRouteSchema, sponsorshipInquirySchema } from "../../../../assets/shared/schemas/sponsorship";
import { openApiRoute } from "../../../_lib/openapi/route";
import type { z } from "zod";

type SponsorshipInquiry = z.infer<typeof sponsorshipInquirySchema>;

async function enforceSponsorshipInquiryRateLimit(c: any): Promise<void> {
  await enforceRateLimit({
    binding: c.env.IP_RATE_LIMITER,
    namespace: "sponsorship-inquiries:ip",
    key: getClientIp(c.req.raw),
  });
}

async function handleSponsorshipInquiry(c: any, body: SponsorshipInquiry): Promise<Response> {
  const env = c.env;
  const db = env.DB;

  // Resolve the public event slug before preparing the sponsorship write. An
  // unknown event must not silently become an event sponsorship with no FK.
  let event: Awaited<ReturnType<typeof getEventBySlug>> | null = null;
  if (body.eventId) {
    try {
      event = await getEventBySlug(db, body.eventId);
    } catch (error) {
      if (error instanceof AppError && error.code === "EVENT_NOT_FOUND") {
        throw new AppError(422, "UNKNOWN_EVENT", "Unknown sponsorship event");
      }
      throw error;
    }
  }
  const sponsorType = event ? ("event" as const) : ("consortium" as const);
  if (body.tier && !(await isActiveSponsorshipTier(db, sponsorType, body.tier))) {
    throw new AppError(422, "UNKNOWN_TIER", `Unknown or unsupported sponsorship tier: ${body.tier}`, {
      supportedTiers: await listActiveSponsorshipTierNames(db, sponsorType),
    });
  }
  const organizationId = await findOrganizationIdByName(db, body.organizationName);

  const created = await createSponsorshipInquiry(db, {
    sponsorType,
    organizationId,
    organizationName: body.organizationName,
    nonMemberName: organizationId ? null : body.organizationName,
    nonMemberWebsite: body.organizationWebsite ?? null,
    contactName: body.contactName,
    contactEmail: body.contactEmail,
    eventId: event?.id ?? null,
    tier: body.tier,
    notes: body.comments ?? null,
    eventName: event?.name ?? "",
    brochureUrl: env.SPONSORSHIP_BROCHURE_URL ?? "https://pkic.org/sponsors/",
    notificationEmail: env.SPONSORSHIP_NOTIFICATION_EMAIL ?? "sponsorships@pkic.org",
    adminUrl: `${resolveAppBaseUrl(env, c.req.raw)}/admin/`,
  });
  for (const outboxId of created.outboxIds) {
    c.executionCtx.waitUntil(processOutboxByIdBackground(db, env, outboxId));
  }

  return json({ sponsorshipId: created.id, pipelineStage: "new_inquiry" }, 201);
}

export const SponsorshipInquiriesPost = openApiRoute(
  sponsorshipInquiryRouteSchema,
  (c: any, data) => handleSponsorshipInquiry(c, data.body),
  enforceSponsorshipInquiryRateLimit,
);
