/**
 * GET  /api/v1/admin/sponsorships — sales pipeline list (PRD §4.13)
 * POST /api/v1/admin/sponsorships — create a sponsorship record directly
 *                                    (staff-booked, not from a public
 *                                    inquiry/checkout)
 */
import { OpenAPIRoute } from "chanfana";
import { parseJsonBody } from "../../../../_lib/validation";
import { json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { requirePermission } from "../../../../_lib/auth/permissions";
import { writeAuditLog } from "../../../../_lib/services/audit";
import {
  createAdminSponsorship,
  getAdminSponsorship,
  listAdminSponsorships,
  toApiSponsorship,
} from "../../../../_lib/services/sponsorship";
import {
  sponsorshipCreateSchema,
  sponsorshipCreateRouteSchema,
  sponsorshipsListQuerySchema,
  sponsorshipsListRouteSchema,
} from "../../../../../assets/shared/schemas/admin-sponsorships";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  requirePermission(admin, "sponsorships:read");

  const url = new URL(c.req.raw.url);
  const parsed = sponsorshipsListQuerySchema.safeParse({
    type: url.searchParams.get("type") ?? undefined,
    stage: url.searchParams.get("stage") ?? undefined,
    tier: url.searchParams.get("tier") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
    offset: url.searchParams.get("offset") ?? undefined,
  });
  const type = parsed.success ? parsed.data.type : undefined;
  const stage = parsed.success ? parsed.data.stage : undefined;
  const tier = parsed.success ? parsed.data.tier : undefined;
  const limit = parsed.success ? (parsed.data.limit ?? 50) : 50;
  const offset = parsed.success ? (parsed.data.offset ?? 0) : 0;

  const { sponsorships, total } = await listAdminSponsorships(db, { type, stage, tier, limit, offset });
  return json({
    sponsorships: sponsorships.map(toApiSponsorship),
    page: { limit, offset, total, hasMore: offset + sponsorships.length < total },
  });
}

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  requirePermission(admin, "sponsorships:write");

  const body = await parseJsonBody(c.req, sponsorshipCreateSchema);
  const { id } = await createAdminSponsorship(db, {
    sponsorType: body.sponsorType,
    organizationId: body.organizationId ?? null,
    nonMemberName: body.nonMemberName ?? null,
    nonMemberWebsite: body.nonMemberWebsite ?? null,
    contactName: body.contactName ?? null,
    contactEmail: body.contactEmail ?? null,
    eventId: body.eventId ?? null,
    tier: body.tier ?? null,
    assignedToUserId: body.assignedToUserId ?? null,
    renewalDate: body.renewalDate ?? null,
    notes: body.notes ?? null,
  });

  await writeAuditLog(db, "admin", admin.id, "sponsorship_created", "sponsorship", id, {
    sponsorType: body.sponsorType,
  });

  const sponsorship = (await getAdminSponsorship(db, id))!;
  return json({ sponsorship: toApiSponsorship(sponsorship) }, 201);
}

export class SponsorshipsList extends OpenAPIRoute {
  schema = sponsorshipsListRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestGet(c);
  }
}

export class SponsorshipsCreate extends OpenAPIRoute {
  schema = sponsorshipCreateRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestPost(c);
  }
}
