/**
 * DELETE /api/v1/admin/users/:userId/emails/:emailId — remove a secondary email
 */
import { OpenAPIRoute } from "chanfana";
import { json } from "../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../../_lib/auth/permissions";
import { writeAuditLog } from "../../../../../../_lib/services/audit";
import { removeUserEmail } from "../../../../../../_lib/services/user-emails";
import { userEmailRemoveRouteSchema } from "../../../../../../../assets/shared/schemas/user-emails";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";

export async function onRequestDelete(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "users:write");

  const userId = c.req.param("userId");
  const emailId = c.req.param("emailId");
  await removeUserEmail(requestDb(c), userId, emailId);

  await writeAuditLog(requestDb(c), "admin", admin.id, "user_email_removed", "user", userId, { emailId });

  return json({ success: true });
}

export class UserEmailsRemove extends OpenAPIRoute {
  schema = userEmailRemoveRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestDelete(c);
  }
}
