import { requireStaffPermission } from "../../../../_lib/auth/staff-permissions";
import type { AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { listActiveSponsorshipTierNames, listTierConfig } from "../../../../_lib/services/sponsorship";
import {
  managedSponsorTiersResponseSchema,
  publicSponsorTiersResponseSchema,
  sponsorTiersRouteSchema,
} from "../../../../../assets/shared/schemas/sponsors";

const PUBLIC_CACHE_CONTROL = "public, max-age=300, s-maxage=900, stale-while-revalidate=60";

export const SponsorTiersGet = openApiRoute(sponsorTiersRouteSchema, async (c: AdminContext, data) => {
  if (data.query.includeInactive) {
    const { db } = await requireStaffPermission(c, "sponsorships:read");
    return json(
      managedSponsorTiersResponseSchema.parse({
        visibility: "all",
        tiers: await listTierConfig(db, data.query.sponsorType),
      }),
    );
  }

  const sponsorType = data.query.sponsorType ?? "consortium";
  const tiers = await listActiveSponsorshipTierNames(c.env.DB, sponsorType);
  const response = json(
    publicSponsorTiersResponseSchema.parse({
      visibility: "public",
      sponsorType,
      tiers: tiers.map((tier) => ({ tier })),
    }),
  );
  response.headers.set("cache-control", PUBLIC_CACHE_CONTROL);
  return response;
});
