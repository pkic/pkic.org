/**
 * POST /api/v1/sponsorship/inquiries
 *
 * express interest, no payment. Replaces POST
 * /api/v1/forms (form_type=sponsor-interest).
 */
import { OpenAPIRoute } from "chanfana";
import { parseJsonBody } from "../../../_lib/validation";
import { json } from "../../../_lib/http";
import { enforceRateLimit } from "../../../_lib/rate-limit";
import { getClientIp } from "../../../_lib/request";
import { queueEmail, processOutboxByIdBackground } from "../../../_lib/email/outbox";
import { writeAuditLog } from "../../../_lib/services/audit";
import { getEventBySlug } from "../../../_lib/services/events";
import { createSponsorshipInquiry, findOrganizationIdByName } from "../../../_lib/services/sponsorship";
import { sponsorshipInquiryRouteSchema, sponsorshipInquirySchema } from "../../../../assets/shared/schemas/sponsorship";

export async function onRequestPost(c: any): Promise<Response> {
  const env = c.env;
  const db = env.DB;

  await enforceRateLimit({
    binding: env.IP_RATE_LIMITER,
    namespace: "sponsorship-inquiries:ip",
    key: getClientIp(c.req.raw),
  });

  const body = await parseJsonBody(c.req, sponsorshipInquirySchema);
  const sponsorType: "consortium" | "event" = body.eventId ? "event" : "consortium";
  // eventId is the public event slug (e.g. 'pqc-2026') — resolved to the
  // internal events.id, which sponsorships.event_id FK-references.
  const event = body.eventId ? await getEventBySlug(db, body.eventId) : null;
  const organizationId = await findOrganizationIdByName(db, body.organizationName);

  const created = await createSponsorshipInquiry(db, {
    sponsorType,
    organizationId,
    nonMemberName: organizationId ? null : body.organizationName,
    nonMemberWebsite: body.organizationWebsite ?? null,
    contactName: body.contactName,
    contactEmail: body.contactEmail,
    eventId: event?.id ?? null,
    tier: body.desiredTier,
    notes: body.comments ?? null,
  });

  const brochureOutboxId = await queueEmail(db, {
    templateKey: "sponsorship-brochure",
    recipientEmail: body.contactEmail,
    messageType: "transactional",
    subject: "PKI Consortium sponsorship information",
    data: {
      contactName: body.contactName,
      eventName: event?.name ?? "",
      brochureUrl: env.SPONSORSHIP_BROCHURE_URL ?? "https://pkic.org/sponsors/",
    },
  });
  c.executionCtx.waitUntil(processOutboxByIdBackground(db, env, brochureOutboxId));

  const staffOutboxId = await queueEmail(db, {
    templateKey: "sponsorship-new-inquiry",
    recipientEmail: env.SPONSORSHIP_NOTIFICATION_EMAIL ?? "sponsorships@pkic.org",
    messageType: "transactional",
    subject: `New sponsorship inquiry: ${body.contactName} (${body.organizationName})`,
    data: {
      contactName: body.contactName,
      contactEmail: body.contactEmail,
      organizationName: body.organizationName,
      sponsorType,
      tier: body.desiredTier,
      notes: body.comments ?? "",
      adminUrl: "https://pkic.org/admin/",
    },
  });
  c.executionCtx.waitUntil(processOutboxByIdBackground(db, env, staffOutboxId));

  await writeAuditLog(db, "public", null, "sponsorship_inquiry_submitted", "sponsorship", created.id, {
    sponsorType,
    tier: body.desiredTier,
    organizationName: body.organizationName,
  });

  return json({ sponsorshipId: created.id, pipelineStage: "new_inquiry" }, 201);
}

export class SponsorshipInquiriesPost extends OpenAPIRoute {
  schema = sponsorshipInquiryRouteSchema;

  async handle(c: any) {
    return onRequestPost(c);
  }
}
