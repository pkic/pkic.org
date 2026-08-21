import { requireAdminFromRequest } from "../../../../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { dispatchRequestMethod, json } from "../../../../../../_lib/http";
import { revokeEventTeamRole } from "../../../../../../_lib/services/events/team";

export async function onRequestDelete(c: AdminContext): Promise<Response> {
  const actor = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  await revokeEventTeamRole(requestDb(c), actor, c.req.param("eventSlug"), c.req.param("permId"));
  return json({ success: true });
}

export async function onRequest(c: AdminContext): Promise<Response> {
  return dispatchRequestMethod(c, { DELETE: onRequestDelete });
}
