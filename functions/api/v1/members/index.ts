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
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";

const PUBLIC_CACHE_CONTROL = "public, max-age=300, s-maxage=900, stale-while-revalidate=60";

export const MembersGet = openApiRoute(membersListRouteSchema, async (c: any, data) => {
  const { limit, offset, q, sort, group } = data.query;

  const { members, total } = await listPublicMembers(c.env.DB, { limit, offset, q, sort, group });

  const response = json({ members, page: buildPageInfo(limit, offset, total, members.length) });
  response.headers.set("cache-control", PUBLIC_CACHE_CONTROL);
  return response;
});
