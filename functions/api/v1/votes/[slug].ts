/**
 * GET /api/v1/votes/:slug — public vote result at its configured detail
 * level. 404s for a vote that exists but isn't public, same as
 * "not found" — never leaks existence of a private vote.
 */
import { json } from "../../../_lib/http";
import { getPublicVoteBySlug } from "../../../_lib/services/votes";
import { publicVoteGetRouteSchema } from "../../../../assets/shared/schemas/votes";
import { openApiRoute } from "../../../_lib/openapi/route";

export const VotesSlugGet = openApiRoute(publicVoteGetRouteSchema, async (c: any, data) => {
  const { slug } = data.params;
  const vote = await getPublicVoteBySlug(c.env.DB, slug);
  const response = json({ vote });
  response.headers.set("cache-control", "public, max-age=60, s-maxage=300, stale-while-revalidate=60");
  return response;
});
