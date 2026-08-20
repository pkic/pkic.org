/**
 * DELETE /api/v1/admin/users/:userId/roles/:userRoleId — revoke a role assignment
 * PATCH  /api/v1/admin/users/:userId/roles/:userRoleId — change an assignment's expiry date
 */
import { json } from "../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../../_lib/auth/permissions";
import { first } from "../../../../../../_lib/db/queries";
import { nowIso } from "../../../../../../_lib/utils/time";
import { prepareAuditLog } from "../../../../../../_lib/services/audit";
import {
  userRoleRevokeRouteSchema,
  userRoleUpdateExpiryRouteSchema,
} from "../../../../../../../assets/shared/schemas/access-control";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../../_lib/openapi/route";

interface UserRoleRow {
  id: string;
  user_id: string;
  role_id: string;
}

interface UserRoleWithRoleRow extends UserRoleRow {
  role_name: string;
  context_type: string | null;
  context_id: string | null;
  expires_at: string | null;
  created_at: string;
}

export const UserRolesRevoke = openApiRoute(userRoleRevokeRouteSchema, async (c: AdminContext, data) => {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "access:revoke");

  const row = await first<UserRoleRow>(
    requestDb(c),
    "SELECT id, user_id, role_id FROM user_roles WHERE id = ? AND user_id = ? AND revoked_at IS NULL",
    [data.params.userRoleId, data.params.userId],
  );

  if (!row) {
    return json({ error: { code: "NOT_FOUND", message: "Role assignment not found" } }, 404);
  }

  const now = nowIso();
  await requestDb(c).batch([
    requestDb(c).prepare("UPDATE user_roles SET revoked_at = ? WHERE id = ?").bind(now, row.id),
    prepareAuditLog(
      requestDb(c),
      "admin",
      admin.id,
      "user_role_revoked",
      "user_roles",
      row.id,
      { userId: row.user_id, roleId: row.role_id },
      now,
    ),
  ]);

  return json({ success: true });
});

export const UserRolesUpdateExpiry = openApiRoute(userRoleUpdateExpiryRouteSchema, async (c: AdminContext, data) => {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "access:grant");

  const body = data.body;

  const row = await first<UserRoleRow>(
    requestDb(c),
    "SELECT id, user_id, role_id FROM user_roles WHERE id = ? AND user_id = ? AND revoked_at IS NULL",
    [data.params.userRoleId, data.params.userId],
  );

  if (!row) {
    return json({ error: { code: "NOT_FOUND", message: "Role assignment not found" } }, 404);
  }

  const now = nowIso();
  await requestDb(c).batch([
    requestDb(c).prepare("UPDATE user_roles SET expires_at = ? WHERE id = ?").bind(body.expiresAt, row.id),
    prepareAuditLog(
      requestDb(c),
      "admin",
      admin.id,
      "user_role_expiry_updated",
      "user_roles",
      row.id,
      { userId: row.user_id, roleId: row.role_id, expiresAt: body.expiresAt },
      now,
    ),
  ]);

  const updated = await first<UserRoleWithRoleRow>(
    requestDb(c),
    `SELECT ur.id, ur.user_id, ur.role_id, r.name AS role_name, ur.context_type, ur.context_id, ur.expires_at, ur.created_at
     FROM user_roles ur
     JOIN roles r ON r.id = ur.role_id
     WHERE ur.id = ?`,
    [row.id],
  );
  if (!updated) {
    return json({ error: { code: "NOT_FOUND", message: "Role assignment not found" } }, 404);
  }

  return json({
    role: {
      id: updated.id,
      userId: updated.user_id,
      roleId: updated.role_id,
      roleName: updated.role_name,
      contextType: updated.context_type,
      contextId: updated.context_id,
      expiresAt: updated.expires_at,
      createdAt: updated.created_at,
    },
  });
});
