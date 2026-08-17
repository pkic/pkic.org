/**
 * GET /api/v1/members
 *
 * Public, paginated member directory. Strong cache headers
 * per the success metric: "public read only API endpoint with strong
 * http cache instructions (CDN + client) to avoid a spike in expensive db
 * calls for mostly static data."
 */
import { json } from "../../../_lib/http";
import { listPublicMembers } from "../../../_lib/services/membership/directory";
import { membersListQuerySchema, membersListRouteSchema } from "../../../../assets/shared/schemas/members-directory";
import { openApiRoute } from "../../../_lib/openapi/route";

const PUBLIC_CACHE_CONTROL = "public, max-age=300, s-maxage=900, stale-while-revalidate=60";

export async function onRequestGet(c: any): Promise<Response> {
  const url = new URL(c.req.raw.url);
  const parsed = membersListQuerySchema.safeParse({
    limit: url.searchParams.get("limit") ?? undefined,
    offset: url.searchParams.get("offset") ?? undefined,
    q: url.searchParams.get("q") ?? undefined,
    group: url.searchParams.get("group") ?? undefined,
  });
  const limit = parsed.success ? (parsed.data.limit ?? 20) : 20;
  const offset = parsed.success ? (parsed.data.offset ?? 0) : 0;
  const q = parsed.success ? parsed.data.q : undefined;
  const group = parsed.success ? (parsed.data.group ?? "all") : "all";

  const { members, total } = await listPublicMembers(c.env.DB, { limit, offset, q, group });

  const response = json({ members, total, limit, offset });
  response.headers.set("cache-control", PUBLIC_CACHE_CONTROL);
  return response;
}

export const MembersGet = openApiRoute(membersListRouteSchema, onRequestGet);
