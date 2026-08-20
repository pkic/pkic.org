/**
 * DELETE /api/v1/admin/roles/:id — delete a custom role
 *
 * System roles (`is_system_role = 1`) cannot be deleted; a role still
 * assigned to any user (active `user_roles` row) cannot be deleted either —
 * both per tests/roles.test.ts.
 */
import { json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { requirePermission } from "../../../../_lib/auth/permissions";
import { first } from "../../../../_lib/db/queries";
import { prepareAuditLog } from "../../../../_lib/services/audit";
import { roleDeleteRouteSchema } from "../../../../../assets/shared/schemas/access-control";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";

interface RoleRow {
  id: string;
  name: string;
  is_system_role: number;
}

export const RolesDelete = openApiRoute(roleDeleteRouteSchema, async (c: AdminContext, data) => {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "access:revoke");

  const role = await first<RoleRow>(requestDb(c), "SELECT id, name, is_system_role FROM roles WHERE id = ?", [
    data.params.id,
  ]);

  if (!role) {
    return json({ error: { code: "NOT_FOUND", message: "Role not found" } }, 404);
  }

  if (role.is_system_role === 1) {
    return json({ error: { code: "SYSTEM_ROLE", message: "System roles cannot be deleted" } }, 409);
  }

  const assigned = await first<{ id: string }>(
    requestDb(c),
    "SELECT id FROM user_roles WHERE role_id = ? AND revoked_at IS NULL LIMIT 1",
    [role.id],
  );

  if (assigned) {
    return json({ error: { code: "ROLE_IN_USE", message: "Role is still assigned to a user" } }, 409);
  }

  await requestDb(c).batch([
    requestDb(c).prepare("DELETE FROM role_permissions WHERE role_id = ?").bind(role.id),
    requestDb(c).prepare("DELETE FROM roles WHERE id = ?").bind(role.id),
    prepareAuditLog(requestDb(c), "admin", admin.id, "role_deleted", "role", role.id, { name: role.name }),
  ]);

  return json({ success: true });
});
