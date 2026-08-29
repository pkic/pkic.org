import { selfGroupsListResponseSchema } from "../../../../../../assets/shared/schemas/group-participation";
import { buildPageInfo } from "../../../../../../assets/shared/schemas/pagination";
import { selfGroupsListRouteSchema } from "../../../../../../assets/shared/schemas/route-contracts-user-groups";
import { requireMemberFromRequest } from "../../../../../_lib/auth/member";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { listSelfGroups } from "../../../../../_lib/services/groups";

export const CurrentUserGroupsGet = openApiRoute(selfGroupsListRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  const result = await listSelfGroups(db, member.userId, data.query);
  return json(
    selfGroupsListResponseSchema.parse({
      groups: result.groups,
      page: buildPageInfo(data.query.limit, data.query.offset, result.total, result.groups.length),
    }),
  );
});
