/**
 * GET /api/v1/working-groups
 *
 * Public list of active working groups.
 */
import { json } from "../../../_lib/http";
import { listWorkingGroups } from "../../../_lib/services/membership/working-group-directory";
import {
  workingGroupsListResponseSchema,
  workingGroupsListRouteSchema,
} from "../../../../assets/shared/schemas/members-directory";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { openApiRoute } from "../../../_lib/openapi/route";

const PUBLIC_CACHE_CONTROL = "public, max-age=300, s-maxage=900, stale-while-revalidate=60";

export const onRequestGet = openApiRoute(workingGroupsListRouteSchema, async (c: any, data) => {
  const { workingGroups, total } = await listWorkingGroups(c.env.DB, data.query);
  const response = json(
    workingGroupsListResponseSchema.parse({
      workingGroups,
      page: buildPageInfo(data.query.limit, data.query.offset, total, workingGroups.length),
    }),
  );
  response.headers.set("cache-control", PUBLIC_CACHE_CONTROL);
  return response;
});

export const WorkingGroupsGet = onRequestGet;
