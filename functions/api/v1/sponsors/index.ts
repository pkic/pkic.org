/**
 * GET /api/v1/sponsors
 *
 * Public, unauthenticated sponsor list —
 * mirrors GET /api/v1/members's cache-control convention so the public
 * sponsor wall/strip/level pages can be cheap to hit repeatedly.
 */
import { json } from "../../../_lib/http";
import { listPublicSponsorDisplay, listPublicSponsors } from "../../../_lib/services/public-sponsors";
import {
  sponsorsDisplayResponseSchema,
  sponsorsDisplayRouteSchema,
  sponsorsListResponseSchema,
  sponsorsListRouteSchema,
} from "../../../../assets/shared/schemas/public-sponsors";
import { openApiRoute } from "../../../_lib/openapi/route";

const PUBLIC_CACHE_CONTROL = "public, max-age=300, s-maxage=900, stale-while-revalidate=60";

export const SponsorsGet = openApiRoute(sponsorsListRouteSchema, async (c: any, data) => {
  const body = sponsorsListResponseSchema.parse(await listPublicSponsors(c.env.DB, data.query));

  const response = json(body);
  response.headers.set("cache-control", PUBLIC_CACHE_CONTROL);
  return response;
});

export const SponsorsDisplayGet = openApiRoute(sponsorsDisplayRouteSchema, async (c: any, data) => {
  const body = sponsorsDisplayResponseSchema.parse(await listPublicSponsorDisplay(c.env.DB, data.query));
  const response = json(body);
  response.headers.set("cache-control", PUBLIC_CACHE_CONTROL);
  return response;
});
