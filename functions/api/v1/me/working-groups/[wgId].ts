/**
 * POST/DELETE /api/v1/me/working-groups/:wgId — join/leave a working group.
 * :wgId accepts either the WG UUID or its slug.
 */
import { json } from "../../../../_lib/http";
import { requireMemberFromRequest } from "../../../../_lib/auth/member";
import { joinMyWorkingGroup, leaveMyWorkingGroup } from "../../../../_lib/services/member-self-service";
import { myWorkingGroupJoinRouteSchema, myWorkingGroupLeaveRouteSchema } from "../../../../../assets/shared/schemas/me";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";

export const MeWorkingGroupJoinPost = openApiRoute(myWorkingGroupJoinRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  await joinMyWorkingGroup(db, member, data.params.wgId);
  return json({ success: true });
});

export const MeWorkingGroupLeaveDelete = openApiRoute(myWorkingGroupLeaveRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  await leaveMyWorkingGroup(db, member, data.params.wgId);
  return json({ success: true });
});
