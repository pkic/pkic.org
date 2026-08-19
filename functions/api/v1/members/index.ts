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
import { membersListRouteSchema } from "../../../../assets/shared/schemas/members-directory";
import { openApiRoute } from "../../../_lib/openapi/route";

const PUBLIC_CACHE_CONTROL = "public, max-age=300, s-maxage=900, stale-while-revalidate=60";

export const MembersGet = openApiRoute(membersListRouteSchema, async (c: any, data) => {
  const { limit = 20, offset = 0, q, group = "all" } = data.query;

  const { members, total } = await listPublicMembers(c.env.DB, { limit, offset, q, group });

  const response = json({ members, total, limit, offset });
  response.headers.set("cache-control", PUBLIC_CACHE_CONTROL);
  return response;
});
