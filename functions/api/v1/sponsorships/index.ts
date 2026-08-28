/**
 * GET  /api/v1/sponsorships — sales pipeline list
 * POST /api/v1/sponsorships — create a sponsorship record directly
 *                                    (staff-booked, not from a public
 *                                    inquiry/checkout)
 */
import { json } from "../../../_lib/http";
import {
  authorizedSponsorshipMutationDb,
  createSponsorship,
  getSponsorship,
  listSponsorships,
  toApiSponsorship,
} from "../../../_lib/services/sponsorship";
import {
  sponsorshipCreateRouteSchema,
  sponsorshipsListResponseSchema,
  sponsorshipsListRouteSchema,
} from "../../../../assets/shared/schemas/sponsorship-management";
import type { AdminContext } from "../../../_lib/db/context";
import { openApiRoute } from "../../../_lib/openapi/route";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { requireSystemPermission as requireStaffPermission } from "../system/authorization";

export const SponsorshipsList = openApiRoute(sponsorshipsListRouteSchema, async (c: AdminContext, data) => {
  const { db } = await requireStaffPermission(c, "sponsorships:read");

  const { sponsorships, total } = await listSponsorships(db, data.query);
  return json(
    sponsorshipsListResponseSchema.parse({
      sponsorships: sponsorships.map(toApiSponsorship),
      page: buildPageInfo(data.query.limit, data.query.offset, total, sponsorships.length),
    }),
  );
});

export const SponsorshipsCreate = openApiRoute(sponsorshipCreateRouteSchema, async (c: AdminContext, data) => {
  const { db, staff } = await requireStaffPermission(c, "sponsorships:write");
  const authorizedDb = authorizedSponsorshipMutationDb(db, staff);

  const body = data.body;
  const { id } = await createSponsorship(authorizedDb, staff, {
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

  const sponsorship = (await getSponsorship(authorizedDb, id))!;
  return json({ sponsorship: toApiSponsorship(sponsorship) }, 201);
});
