/**
 * GET /api/v1/votes — public, machine-consumable, filterable, paginated
 * list of votes with visibility='public'.
 */
import { OpenAPIRoute } from "chanfana";
import { json } from "../../../_lib/http";
import { listPublicVotes } from "../../../_lib/services/votes";
import { publicVotesListQuerySchema, publicVotesListRouteSchema } from "../../../../assets/shared/schemas/votes";

export async function onRequestGet(c: any): Promise<Response> {
  const url = new URL(c.req.raw.url);
  const parsed = publicVotesListQuerySchema.safeParse({
    type: url.searchParams.get("type") ?? undefined,
    scope: url.searchParams.get("scope") ?? undefined,
    wg: url.searchParams.get("wg") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    page: url.searchParams.get("page") ?? undefined,
    per_page: url.searchParams.get("per_page") ?? undefined,
    sort: url.searchParams.get("sort") ?? undefined,
  });
  const q = parsed.success ? parsed.data : {};
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
}

export class VotesGet extends OpenAPIRoute {
  schema = publicVotesListRouteSchema;
  async handle(c: any): Promise<Response> {
    return onRequestGet(c);
  }
}
