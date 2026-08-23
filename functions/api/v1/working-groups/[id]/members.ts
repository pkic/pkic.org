import { buildPageInfo } from "../../../../../assets/shared/schemas/pagination";
import {
  publicWorkingGroupMembersListResponseSchema,
  publicWorkingGroupMembersListRouteSchema,
} from "../../../../../assets/shared/schemas/members-directory";
import { AppError } from "../../../../_lib/errors";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { listWorkingGroupMembers } from "../../../../_lib/services/membership/working-group-directory";
import type { AdminContext } from "../../../../_lib/db/context";

const PUBLIC_CACHE_CONTROL = "public, max-age=300, s-maxage=900, stale-while-revalidate=60";

export const WorkingGroupMembersGet = openApiRoute(
  publicWorkingGroupMembersListRouteSchema,
  async (c: AdminContext, data) => {
    const result = await listWorkingGroupMembers(c.env.DB, data.params.wgId, data.query);
    if (!result) throw new AppError(404, "WORKING_GROUP_NOT_FOUND", "Working group not found");
    const response = json(
      publicWorkingGroupMembersListResponseSchema.parse({
        members: result.members,
        page: buildPageInfo(data.query.limit, data.query.offset, result.total, result.members.length),
      }),
    );
    response.headers.set("cache-control", PUBLIC_CACHE_CONTROL);
    return response;
  },
);
