/**
 * GET /api/v1/votes — public, machine-consumable, filterable, paginated
 * list of votes with visibility='public'.
 */
import { json } from "../../../_lib/http";
import { listPublicVotes } from "../../../_lib/services/votes";
import { publicVotesListRouteSchema } from "../../../../assets/shared/schemas/votes";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { openApiRoute } from "../../../_lib/openapi/route";

export const VotesGet = openApiRoute(publicVotesListRouteSchema, async (c: any, data) => {
  const q = data.query;
  const { limit, offset } = q;

  const { votes, total } = await listPublicVotes(c.env.DB, {
    type: q.type,
    scope: q.scope,
    wg: q.wg,
    status: q.status,
    from: q.from,
    to: q.to,
    q: q.q,
    limit,
    offset,
    sort: q.sort,
  });

  const response = json({ votes, page: buildPageInfo(limit, offset, total, votes.length) });
  response.headers.set("cache-control", "public, max-age=60, s-maxage=300, stale-while-revalidate=60");
  return response;
});
