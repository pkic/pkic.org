/**
 * GET  /api/v1/admin/sponsorships — sales pipeline list
 * POST /api/v1/admin/sponsorships — create a sponsorship record directly
 *                                    (staff-booked, not from a public
 *                                    inquiry/checkout)
 */
import { json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { requirePermission } from "../../../../_lib/auth/permissions";
import {
  createAdminSponsorship,
  getAdminSponsorship,
  listAdminSponsorships,
  toApiSponsorship,
} from "../../../../_lib/services/sponsorship";
import {
  sponsorshipCreateRouteSchema,
  sponsorshipsListRouteSchema,
} from "../../../../../assets/shared/schemas/admin-sponsorships";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { buildPageInfo } from "../../../../../assets/shared/schemas/pagination";

export const SponsorshipsList = openApiRoute(sponsorshipsListRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  requirePermission(admin, "sponsorships:read");

  const { type, stage, tier, q, sort, limit, offset } = data.query;

  const { sponsorships, total } = await listAdminSponsorships(db, { type, stage, tier, q, sort, limit, offset });
  return json({
    sponsorships: sponsorships.map(toApiSponsorship),
    page: buildPageInfo(limit, offset, total, sponsorships.length),
  });
});

export const SponsorshipsCreate = openApiRoute(sponsorshipCreateRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  requirePermission(admin, "sponsorships:write");

  const body = data.body;
  const { id } = await createAdminSponsorship(db, admin.id, {
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

  const sponsorship = (await getAdminSponsorship(db, id))!;
  return json({ sponsorship: toApiSponsorship(sponsorship) }, 201);
});
