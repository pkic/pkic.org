/**
 * GET /api/v1/working-groups
 *
 * Public list of active working groups.
 */
import { json } from "../../../_lib/http";
import { listWorkingGroups } from "../../../_lib/services/members-directory";
import { workingGroupsListRouteSchema } from "../../../../assets/shared/schemas/members-directory";
import { openApiRoute } from "../../../_lib/openapi/route";

const PUBLIC_CACHE_CONTROL = "public, max-age=300, s-maxage=900, stale-while-revalidate=60";

export async function onRequestGet(c: any): Promise<Response> {
  const workingGroups = await listWorkingGroups(c.env.DB);
  const response = json({ workingGroups });
  response.headers.set("cache-control", PUBLIC_CACHE_CONTROL);
  return response;
}

// Thin openApiRoute wrap — onRequestGet is imported directly by
// tests/public-members-api.test.ts, so it stays untouched. GET has no
// request body, so wrapping is safe.
export const WorkingGroupsGet = openApiRoute(workingGroupsListRouteSchema, (c: any) => onRequestGet(c));
