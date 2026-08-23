/**
 * GET /api/v1/me/working-groups — my working group memberships.
 */
import { json } from "../../../../_lib/http";
import { requireMemberFromRequest } from "../../../../_lib/auth/member";
import { listMyWorkingGroups } from "../../../../_lib/services/member-working-groups";
import {
  myWorkingGroupsListResponseSchema,
  myWorkingGroupsListRouteSchema,
} from "../../../../../assets/shared/schemas/me";
import { buildPageInfo } from "../../../../../assets/shared/schemas/pagination";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";

export const MeWorkingGroupsGet = openApiRoute(myWorkingGroupsListRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  const { workingGroups, total } = await listMyWorkingGroups(db, member, data.query);
  return json(
    myWorkingGroupsListResponseSchema.parse({
      workingGroups,
      page: buildPageInfo(data.query.limit, data.query.offset, total, workingGroups.length),
    }),
  );
});
