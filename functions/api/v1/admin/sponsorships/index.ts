/**
 * GET  /api/v1/admin/sponsorships — sales pipeline list
 * POST /api/v1/admin/sponsorships — create a sponsorship record directly
 *                                    (staff-booked, not from a public
 *                                    inquiry/checkout)
 */
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
import { openApiRoute } from "../../../../_lib/openapi/route";
import { parseListQuery } from "../../../../_lib/openapi/list-query";
import { buildPageInfo } from "../../../../../assets/shared/schemas/pagination";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  requirePermission(admin, "sponsorships:read");

  const {
    type,
    stage,
    tier,
    limit = 50,
    offset = 0,
  } = parseListQuery(sponsorshipsListQuerySchema, new URL(c.req.raw.url), ["type", "stage", "tier", "limit", "offset"]);

  const { sponsorships, total } = await listAdminSponsorships(db, { type, stage, tier, limit, offset });
  return json({
    sponsorships: sponsorships.map(toApiSponsorship),
    page: buildPageInfo(limit, offset, total, sponsorships.length),
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

export const SponsorshipsList = openApiRoute(sponsorshipsListRouteSchema, onRequestGet);
export const SponsorshipsCreate = openApiRoute(sponsorshipCreateRouteSchema, onRequestPost);
