/**
 * GET /api/v1/sponsors
 *
 * Public, unauthenticated sponsor list —
 * mirrors GET /api/v1/members's cache-control convention so the public
 * sponsor wall/strip/level pages can be cheap to hit repeatedly.
 */
import { requireStaffPermission } from "../../../_lib/auth/staff-permissions";
import type { AdminContext } from "../../../_lib/db/context";
import { json } from "../../../_lib/http";
import { listPublicSponsorDisplay, listPublicSponsors } from "../../../_lib/services/public-sponsors";
import {
  authorizedSponsorshipMutationDb,
  createSponsorship,
  getSponsorship,
  listSponsorships,
  toApiSponsorship,
} from "../../../_lib/services/sponsorship";
import {
  sponsorsDisplayResponseSchema,
  sponsorsDisplayRouteSchema,
} from "../../../../assets/shared/schemas/public-sponsors";
import { sponsorshipCreateRouteSchema } from "../../../../assets/shared/schemas/sponsorship-management";
import {
  sponsorsCollectionResponseSchema,
  sponsorsCollectionRouteSchema,
} from "../../../../assets/shared/schemas/sponsors";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { openApiRoute } from "../../../_lib/openapi/route";

const PUBLIC_CACHE_CONTROL = "public, max-age=300, s-maxage=900, stale-while-revalidate=60";

export const SponsorsGet = openApiRoute(sponsorsCollectionRouteSchema, async (c: AdminContext, data) => {
  if (data.query.visibility === "all") {
    const { db } = await requireStaffPermission(c, "sponsorships:read");
    const { sponsorships, total } = await listSponsorships(db, data.query);
    return json(
      sponsorsCollectionResponseSchema.parse({
        sponsorships: sponsorships.map(toApiSponsorship),
        page: buildPageInfo(data.query.limit, data.query.offset, total, sponsorships.length),
      }),
    );
  }

  const body = sponsorsCollectionResponseSchema.parse(await listPublicSponsors(c.env.DB, data.query));

  const response = json(body);
  response.headers.set("cache-control", PUBLIC_CACHE_CONTROL);
  return response;
});

export const SponsorsCreate = openApiRoute(sponsorshipCreateRouteSchema, async (c: AdminContext, data) => {
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

export const SponsorsDisplayGet = openApiRoute(sponsorsDisplayRouteSchema, async (c: any, data) => {
  const body = sponsorsDisplayResponseSchema.parse(await listPublicSponsorDisplay(c.env.DB, data.query));
  const response = json(body);
  response.headers.set("cache-control", PUBLIC_CACHE_CONTROL);
  return response;
});
