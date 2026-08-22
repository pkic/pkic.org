/**
 * GET /api/v1/me/working-groups — my working group memberships.
 */
import { json } from "../../../../_lib/http";
import { requireMemberFromRequest } from "../../../../_lib/auth/member";
import { listMyWorkingGroups } from "../../../../_lib/services/member-working-groups";
import {
  myWorkingGroupsListQuerySchema,
  myWorkingGroupsListRouteSchema,
} from "../../../../../assets/shared/schemas/me";
import { buildPageInfo } from "../../../../../assets/shared/schemas/pagination";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";

export const MeWorkingGroupsGet = openApiRoute(myWorkingGroupsListRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  const query = myWorkingGroupsListQuerySchema.parse(data.query);
  const { workingGroups, total } = await listMyWorkingGroups(db, member, query);
  return json({ workingGroups, page: buildPageInfo(query.limit, query.offset, total, workingGroups.length) });
});
