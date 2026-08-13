/**
 * GET /api/v1/votes — public, machine-consumable, filterable, paginated
 * list of votes with visibility='public'.
 */
import { json } from "../../../_lib/http";
import { listPublicVotes } from "../../../_lib/services/votes";
import { publicVotesListRouteSchema } from "../../../../assets/shared/schemas/votes";
import { openApiRoute } from "../../../_lib/openapi/route";

export const VotesGet = openApiRoute(publicVotesListRouteSchema, async (c: any, data) => {
  const q = data.query;
  const page = q.page ?? 1;
  const perPage = q.per_page ?? 20;

  const { votes, total } = await listPublicVotes(c.env.DB, {
    type: q.type,
    scope: q.scope,
    wg: q.wg,
    status: q.status,
    from: q.from,
    to: q.to,
    page,
    perPage,
    sort: q.sort,
  });

  const response = json({ votes, total, page, perPage });
  response.headers.set("cache-control", "public, max-age=60, s-maxage=300, stale-while-revalidate=60");
  return response;
});
