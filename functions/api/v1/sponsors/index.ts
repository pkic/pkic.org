/**
 * GET /api/v1/sponsors
 *
 * Public, unauthenticated sponsor list —
 * mirrors GET /api/v1/members's cache-control convention so the public
 * sponsor wall/strip/level pages can be cheap to hit repeatedly.
 */
import { json } from "../../../_lib/http";
import { listPublicSponsors } from "../../../_lib/services/public-sponsors";
import { sponsorsListRouteSchema } from "../../../../assets/shared/schemas/public-sponsors";
import { openApiRoute } from "../../../_lib/openapi/route";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";

const PUBLIC_CACHE_CONTROL = "public, max-age=300, s-maxage=900, stale-while-revalidate=60";

export const SponsorsGet = openApiRoute(sponsorsListRouteSchema, async (c: any, data) => {
  // Default limit is the schema's max (200): today's sponsor-wall/strip/level
  // pages (assets/ts/member-flows/sponsors-wall.tsx) call this with no
  // ?limit=, expecting the full set, and the consortium's real sponsor count
  // is well under that — this bounds the previously-unbounded query without
  // truncating the existing public display.
  const { eventName, limit = 200, offset = 0 } = data.query;

  const { sponsors, total } = await listPublicSponsors(c.env.DB, { eventName, limit, offset });

  const response = json({ sponsors, page: buildPageInfo(limit, offset, total, sponsors.length) });
  response.headers.set("cache-control", PUBLIC_CACHE_CONTROL);
  return response;
});
