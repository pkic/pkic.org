/**
 * DELETE /api/v1/admin/roles/:id — delete a custom role
 *
 * System roles (`is_system_role = 1`) cannot be deleted; a role still
 * assigned to any user (active `user_roles` row) cannot be deleted either —
 * both per PRD §2.2 and §10.4's tests/roles.test.ts.
 */
import { OpenAPIRoute } from "chanfana";
import { json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { requirePermission } from "../../../../_lib/auth/permissions";
import { first, run } from "../../../../_lib/db/queries";
import { writeAuditLog } from "../../../../_lib/services/audit";
import { roleDeleteRouteSchema } from "../../../../../assets/shared/schemas/access-control";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";

interface RoleRow {
  id: string;
  name: string;
  is_system_role: number;
}

export async function onRequestDelete(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "access:revoke");

  const role = await first<RoleRow>(requestDb(c), "SELECT id, name, is_system_role FROM roles WHERE id = ?", [
    c.req.param("id"),
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

  await run(requestDb(c), "DELETE FROM role_permissions WHERE role_id = ?", [role.id]);
  await run(requestDb(c), "DELETE FROM roles WHERE id = ?", [role.id]);

  await writeAuditLog(requestDb(c), "admin", admin.id, "role_deleted", "role", role.id, { name: role.name });

  return json({ success: true });
}

export class RolesDelete extends OpenAPIRoute {
  schema = roleDeleteRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestDelete(c);
  }
}
