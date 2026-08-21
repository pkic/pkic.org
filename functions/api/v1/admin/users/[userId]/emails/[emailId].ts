/**
 * DELETE /api/v1/admin/users/:userId/emails/:emailId — remove a secondary email
 */
import { json } from "../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../../_lib/auth/permissions";
import { removeUserEmail } from "../../../../../../_lib/services/user-emails";
import { userEmailRemoveRouteSchema } from "../../../../../../../assets/shared/schemas/user-emails";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../../_lib/openapi/route";

export const UserEmailsRemove = openApiRoute(userEmailRemoveRouteSchema, async (c: AdminContext, data) => {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "users:write");

  const userId = data.params.userId;
  const emailId = data.params.emailId;
  await removeUserEmail(requestDb(c), admin, userId, emailId);

  return json({ success: true });
});
