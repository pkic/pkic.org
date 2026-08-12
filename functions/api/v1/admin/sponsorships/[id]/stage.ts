/**
 * PATCH /api/v1/admin/sponsorships/:id/stage — advance the sales pipeline
 * stage. Handles the "On active"/"On lapsed" email side
 * effects here (not in the service layer — see sponsorship.ts's
 * advanceSponsorshipStage doc comment and organization-content-reviews.ts's
 * header note on why routes, not services, own email/R2 side effects).
 */
import { OpenAPIRoute } from "chanfana";
import { parseJsonBody } from "../../../../../_lib/validation";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import { writeAuditLog } from "../../../../../_lib/services/audit";
import { getConfig } from "../../../../../_lib/config";
import { queueEmail, processOutboxByIdBackground } from "../../../../../_lib/email/outbox";
import { advanceSponsorshipStage, toApiSponsorship } from "../../../../../_lib/services/sponsorship";
import { issueSponsorPortalMagicLinkForSponsorship } from "../../../../../_lib/auth/sponsor-portal";
import {
  sponsorshipStageUpdateSchema,
  sponsorshipStageUpdateRouteSchema,
} from "../../../../../../assets/shared/schemas/admin-sponsorships";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export async function onRequestPatch(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  requirePermission(admin, "sponsorships:write");

  const body = await parseJsonBody(c.req, sponsorshipStageUpdateSchema);
  const id = c.req.param("id");
  const result = await advanceSponsorshipStage(db, {
    id,
    toStage: body.toStage,
    actorUserId: admin.id,
    note: body.note ?? null,
  });

  await writeAuditLog(db, "admin", admin.id, "sponsorship_stage_advanced", "sponsorship", id, {
    toStage: body.toStage,
  });

  const config = getConfig(c.env, c.req.raw);
  const { sponsorship } = result;

  if (result.becameActive && sponsorship.sponsor_type === "consortium" && sponsorship.contact_email) {
    const outboxId = await queueEmail(db, {
      templateKey: "sponsorship-active-confirmation",
      recipientEmail: sponsorship.contact_email,
      messageType: "transactional",
      subject: "Your PKI Consortium sponsorship is now active",
      data: {
        contactName: sponsorship.contact_name ?? sponsorship.organization_name ?? "there",
        organizationName: sponsorship.organization_name,
        tier: sponsorship.tier,
        startDate: sponsorship.start_date,
      },
    });
    c.executionCtx.waitUntil(processOutboxByIdBackground(db, c.env, outboxId));
  }

  if (result.becameActive && result.qualifiesForAttendeeDataAccess && sponsorship.contact_email) {
    const token = await issueSponsorPortalMagicLinkForSponsorship(db, id, { ttlMinutes: config.magicLinkTtlMinutes });
    const portalUrl = `${config.appBaseUrl}/sponsor-portal/?token=${encodeURIComponent(token)}`;
    const outboxId = await queueEmail(db, {
      templateKey: "sponsor-portal-access",
      recipientEmail: sponsorship.contact_email,
      messageType: "transactional",
      subject: "Access your sponsor portal",
      data: {
        contactName: sponsorship.contact_name ?? "there",
        tier: sponsorship.tier,
        eventName: sponsorship.event_name,
        portalUrl,
        expiresInMinutes: config.magicLinkTtlMinutes,
      },
    });
    c.executionCtx.waitUntil(processOutboxByIdBackground(db, c.env, outboxId));
  }

  return json({ sponsorship: toApiSponsorship(sponsorship) });
}

export class SponsorshipStageUpdate extends OpenAPIRoute {
  schema = sponsorshipStageUpdateRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestPatch(c);
  }
}
