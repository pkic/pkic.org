/** GET /api/v1/votes/:slug — public cross-group vote detail. */
import { json } from "../../../_lib/http";
import { getPublicVoteBySlug } from "../../../_lib/services/votes";
import { publicVoteGetResponseSchema, publicVoteGetRouteSchema } from "../../../../assets/shared/schemas/votes";
import { openApiRoute } from "../../../_lib/openapi/route";

export const VoteGet = openApiRoute(publicVoteGetRouteSchema, async (c: any, data) => {
  const vote = await getPublicVoteBySlug(c.env.DB, data.params.slug);
  const response = json(publicVoteGetResponseSchema.parse({ vote }));
  response.headers.set("cache-control", "public, max-age=60, s-maxage=300, stale-while-revalidate=60");
  return response;
});
