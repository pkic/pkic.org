/**
 * GET /api/v1/working-groups/:id
 *
 * Working group detail plus a public subset of the member list.
 * :id accepts either the working group UUID or its slug (e.g. 'pqc') for
 * convenience, since the working group slugs are already public via the
 * Hugo content tree at content/wg/.
 */
import { OpenAPIRoute } from "chanfana";
import { AppError } from "../../../_lib/errors";
import { json } from "../../../_lib/http";
import { getWorkingGroupByIdOrSlug } from "../../../_lib/services/members-directory";
import { workingGroupDetailRouteSchema } from "../../../../assets/shared/schemas/members-directory";

const PUBLIC_CACHE_CONTROL = "public, max-age=300, s-maxage=900, stale-while-revalidate=60";

export async function onRequestGet(c: any): Promise<Response> {
  const id = c.req.param("id");
  const workingGroup = await getWorkingGroupByIdOrSlug(c.env.DB, id);
  if (!workingGroup) {
    throw new AppError(404, "WORKING_GROUP_NOT_FOUND", "Working group not found");
  }
  const response = json(workingGroup);
  response.headers.set("cache-control", PUBLIC_CACHE_CONTROL);
  return response;
}

export class WorkingGroupIdGet extends OpenAPIRoute {
  schema = workingGroupDetailRouteSchema;

  async handle(c: any) {
    return onRequestGet(c);
  }
}
