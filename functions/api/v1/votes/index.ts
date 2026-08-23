/**
 * GET /api/v1/votes — public, machine-consumable, filterable, paginated
 * list of votes with visibility='public'.
 */
import { json } from "../../../_lib/http";
import { listPublicVotes } from "../../../_lib/services/votes";
import { publicVotesListResponseSchema, publicVotesListRouteSchema } from "../../../../assets/shared/schemas/votes";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { openApiRoute } from "../../../_lib/openapi/route";

export const VotesGet = openApiRoute(publicVotesListRouteSchema, async (c: any, data) => {
  const { votes, total } = await listPublicVotes(c.env.DB, data.query);

  const response = json(
    publicVotesListResponseSchema.parse({
      votes,
      page: buildPageInfo(data.query.limit, data.query.offset, total, votes.length),
    }),
  );
  response.headers.set("cache-control", "public, max-age=60, s-maxage=300, stale-while-revalidate=60");
  return response;
});
