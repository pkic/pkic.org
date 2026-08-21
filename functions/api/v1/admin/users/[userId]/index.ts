/** GET/PATCH /api/v1/admin/users/:userId — admin user detail and account/profile update. */
import { adminUserUpdateSchema } from "../../../../../../assets/shared/schemas/admin-users";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { dispatchRequestMethod, json } from "../../../../../_lib/http";
import { getAdminUserDetail } from "../../../../../_lib/services/admin-user-detail";
import { updateAdminUser } from "../../../../../_lib/services/admin-user-update";
import { parseJsonBody } from "../../../../../_lib/validation";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  return json({ user: await getAdminUserDetail(requestDb(c), c.req.param("userId")) });
}

export async function onRequestPatch(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const input = await parseJsonBody(c.req, adminUserUpdateSchema);
  return json({ success: true, user: await updateAdminUser(requestDb(c), admin, c.req.param("userId"), input) });
}

export async function onRequest(c: AdminContext): Promise<Response> {
  return dispatchRequestMethod(c, { GET: onRequestGet, PATCH: onRequestPatch });
}
