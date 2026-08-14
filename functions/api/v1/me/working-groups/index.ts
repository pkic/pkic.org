/**
 * GET /api/v1/me/working-groups — my working group memberships.
 */
import { json } from "../../../../_lib/http";
import { requireMemberFromRequest } from "../../../../_lib/auth/member";
import { listMyWorkingGroups } from "../../../../_lib/services/member-self-service";
import { myWorkingGroupsListRouteSchema } from "../../../../../assets/shared/schemas/me";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";

export const MeWorkingGroupsGet = openApiRoute(myWorkingGroupsListRouteSchema, async (c: AdminContext) => {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  const workingGroups = await listMyWorkingGroups(db, member);
  return json({ workingGroups });
});
