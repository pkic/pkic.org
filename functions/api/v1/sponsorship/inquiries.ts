/**
 * POST /api/v1/sponsorship/inquiries
 *
 * express interest, no payment. Replaces POST
 * /api/v1/forms (form_type=sponsor-interest).
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

async function handleSponsorshipInquiry(c: any, body: SponsorshipInquiry): Promise<Response> {
  const env = c.env;
  const db = env.DB;

  await enforceRateLimit({
    binding: env.IP_RATE_LIMITER,
    namespace: "sponsorship-inquiries:ip",
    key: getClientIp(c.req.raw),
  });

  const sponsorType: "consortium" | "event" = body.eventId ? "event" : "consortium";
  if (!(await isActiveSponsorshipTier(db, sponsorType, body.desiredTier))) {
    throw new AppError(422, "UNKNOWN_TIER", `Unknown or unsupported sponsorship tier: ${body.desiredTier}`, {
      supportedTiers: await listActiveSponsorshipTierNames(db, sponsorType),
    });
  }
  // eventId is the public event slug (e.g. 'pqc-2026') — resolved to the
  // internal events.id, which sponsorships.event_id FK-references.
  const event = body.eventId ? await getEventBySlug(db, body.eventId) : null;
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
    tier: body.desiredTier,
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

export const SponsorshipInquiriesPost = openApiRoute(sponsorshipInquiryRouteSchema, (c: any, data) =>
  handleSponsorshipInquiry(c, data.body),
);
