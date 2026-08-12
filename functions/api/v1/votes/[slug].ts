/**
 * GET /api/v1/votes/:slug — public vote result at its configured detail
 * level. 404s for a vote that exists but isn't public, same as
 * "not found" — never leaks existence of a private vote.
 */
import { OpenAPIRoute } from "chanfana";
import { json } from "../../../_lib/http";
import { getPublicVoteBySlug } from "../../../_lib/services/votes";
import { publicVoteGetRouteSchema } from "../../../../assets/shared/schemas/votes";

export async function onRequestGet(c: any): Promise<Response> {
  const slug = c.req.param("slug");
  const vote = await getPublicVoteBySlug(c.env.DB, slug);
  const response = json({ vote });
  response.headers.set("cache-control", "public, max-age=60, s-maxage=300, stale-while-revalidate=60");
  return response;
}

export class VotesSlugGet extends OpenAPIRoute {
  schema = publicVoteGetRouteSchema;
  async handle(c: any): Promise<Response> {
    return onRequestGet(c);
  }
}
