/**
 * DELETE /api/v1/admin/users/:userId/roles/:userRoleId — revoke a role assignment
 */
import { OpenAPIRoute } from "chanfana";
import { json } from "../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../../_lib/auth/permissions";
import { first, run } from "../../../../../../_lib/db/queries";
import { nowIso } from "../../../../../../_lib/utils/time";
import { writeAuditLog } from "../../../../../../_lib/services/audit";
import { userRoleRevokeRouteSchema } from "../../../../../../../assets/shared/schemas/access-control";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";

interface UserRoleRow {
  id: string;
  user_id: string;
  role_id: string;
}

export async function onRequestDelete(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "access:revoke");

  const row = await first<UserRoleRow>(
    requestDb(c),
    "SELECT id, user_id, role_id FROM user_roles WHERE id = ? AND user_id = ? AND revoked_at IS NULL",
    [c.req.param("userRoleId"), c.req.param("userId")],
  );

  if (!row) {
    return json({ error: { code: "NOT_FOUND", message: "Role assignment not found" } }, 404);
  }

  await run(requestDb(c), "UPDATE user_roles SET revoked_at = ? WHERE id = ?", [nowIso(), row.id]);

  await writeAuditLog(requestDb(c), "admin", admin.id, "user_role_revoked", "user_roles", row.id, {
    userId: row.user_id,
    roleId: row.role_id,
  });

  return json({ success: true });
}

export class UserRolesRevoke extends OpenAPIRoute {
  schema = userRoleRevokeRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestDelete(c);
  }
}
