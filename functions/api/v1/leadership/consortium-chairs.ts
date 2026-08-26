/**
 * GET /api/v1/leadership/consortium-chairs — public consortium chair and vice chair.
 *
 * This deliberately publishes only the leadership of the configured All Members
 * group. It does not expose arbitrary group leadership.
 */
import { json } from "../../../_lib/http";
import { getConsortiumChairsPublic } from "../../../_lib/services/leadership";
import { consortiumChairsPublicRouteSchema } from "../../../../assets/shared/schemas/leadership";
import { openApiRoute } from "../../../_lib/openapi/route";

const PUBLIC_CACHE_CONTROL = "public, max-age=300, s-maxage=900, stale-while-revalidate=60";

export const ConsortiumChairsPublicGet = openApiRoute(consortiumChairsPublicRouteSchema, async (c: any) => {
  const chairs = await getConsortiumChairsPublic(c.env.DB);
  const response = json(chairs);
  response.headers.set("cache-control", PUBLIC_CACHE_CONTROL);
  return response;
});
