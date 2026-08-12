/**
 * POST/DELETE /api/v1/me/working-groups/:wgId — join/leave a working group.
 * :wgId accepts either the WG UUID or its slug.
 */
import { OpenAPIRoute } from "chanfana";
import { json } from "../../../../_lib/http";
import { requireMemberFromRequest } from "../../../../_lib/auth/member";
import { joinMyWorkingGroup, leaveMyWorkingGroup } from "../../../../_lib/services/member-self-service";
import { myWorkingGroupJoinRouteSchema, myWorkingGroupLeaveRouteSchema } from "../../../../../assets/shared/schemas/me";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  await joinMyWorkingGroup(db, member, c.req.param("wgId"));
  return json({ success: true });
}

export async function onRequestDelete(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  await leaveMyWorkingGroup(db, member, c.req.param("wgId"));
  return json({ success: true });
}

export class MeWorkingGroupJoinPost extends OpenAPIRoute {
  schema = myWorkingGroupJoinRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestPost(c);
  }
}

export class MeWorkingGroupLeaveDelete extends OpenAPIRoute {
  schema = myWorkingGroupLeaveRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestDelete(c);
  }
}
