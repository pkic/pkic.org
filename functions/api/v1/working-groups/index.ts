/**
 * GET /api/v1/working-groups
 *
 * Public list of active working groups.
 */
import { json } from "../../../_lib/http";
import { listWorkingGroups } from "../../../_lib/services/membership/working-group-directory";
import {
  publicWorkingGroupsListQuerySchema,
  workingGroupsListRouteSchema,
} from "../../../../assets/shared/schemas/members-directory";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { openApiRoute } from "../../../_lib/openapi/route";

const PUBLIC_CACHE_CONTROL = "public, max-age=300, s-maxage=900, stale-while-revalidate=60";

export async function onRequestGet(c: any, query = parsePublicWorkingGroupsQuery(c.req.raw.url)): Promise<Response> {
  const { workingGroups, total } = await listWorkingGroups(c.env.DB, query);
  const response = json({ workingGroups, page: buildPageInfo(query.limit, query.offset, total, workingGroups.length) });
  response.headers.set("cache-control", PUBLIC_CACHE_CONTROL);
  return response;
}

function parsePublicWorkingGroupsQuery(url: string) {
  return publicWorkingGroupsListQuerySchema.parse(Object.fromEntries(new URL(url).searchParams));
}

// Thin openApiRoute wrap — onRequestGet is imported directly by
// tests/public-members-api.test.ts, so it stays untouched. GET has no
// request body, so wrapping is safe.
export const WorkingGroupsGet = openApiRoute(workingGroupsListRouteSchema, (c: any, data) =>
  onRequestGet(c, data.query),
);
