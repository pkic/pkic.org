/**
 * GET /api/v1/working-groups
 *
 * Public list of active working groups (PRD §1.5).
 */
import { OpenAPIRoute } from "chanfana";
import { json } from "../../../_lib/http";
import { listWorkingGroups } from "../../../_lib/services/members-directory";
import { workingGroupsListRouteSchema } from "../../../../assets/shared/schemas/members-directory";

const PUBLIC_CACHE_CONTROL = "public, max-age=300, s-maxage=900, stale-while-revalidate=60";

export async function onRequestGet(c: any): Promise<Response> {
  const workingGroups = await listWorkingGroups(c.env.DB);
  const response = json({ workingGroups });
  response.headers.set("cache-control", PUBLIC_CACHE_CONTROL);
  return response;
}

export class WorkingGroupsGet extends OpenAPIRoute {
  schema = workingGroupsListRouteSchema;

  async handle(c: any) {
    return onRequestGet(c);
  }
}
