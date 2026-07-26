/**
 * GET /api/v1/me/working-groups — my working group memberships (PRD §4.9).
 */
import { OpenAPIRoute } from "chanfana";
import { json } from "../../../../_lib/http";
import { requireMemberFromRequest } from "../../../../_lib/auth/member";
import { listMyWorkingGroups } from "../../../../_lib/services/member-self-service";
import { myWorkingGroupsListRouteSchema } from "../../../../../assets/shared/schemas/me";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  const workingGroups = await listMyWorkingGroups(db, member);
  return json({ workingGroups });
}

export class MeWorkingGroupsGet extends OpenAPIRoute {
  schema = myWorkingGroupsListRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestGet(c);
  }
}
