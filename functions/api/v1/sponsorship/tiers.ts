/**
 * GET /api/v1/sponsorship/tiers?sponsorType=consortium
 *
 * Small public reference-data endpoint for sponsorship inquiry forms. The
 * active filter and deterministic display ordering stay in the D1 service;
 * callers receive only the transport contract they need to render choices.
 */
import { json } from "../../../_lib/http";
import { listActiveSponsorshipTierNames } from "../../../_lib/services/sponsorship";
import {
  sponsorshipTiersResponseSchema,
  sponsorshipTiersRouteSchema,
} from "../../../../assets/shared/schemas/sponsorship";
import { openApiRoute } from "../../../_lib/openapi/route";

const PUBLIC_CACHE_CONTROL = "public, max-age=300, s-maxage=900, stale-while-revalidate=60";

export const SponsorshipTiersGet = openApiRoute(sponsorshipTiersRouteSchema, async (c: any, data) => {
  const sponsorType = data.query.sponsorType;
  const tiers = await listActiveSponsorshipTierNames(c.env.DB, sponsorType);
  const response = json(
    sponsorshipTiersResponseSchema.parse({
      sponsorType,
      tiers: tiers.map((tier) => ({ tier })),
    }),
  );
  response.headers.set("cache-control", PUBLIC_CACHE_CONTROL);
  return response;
});
