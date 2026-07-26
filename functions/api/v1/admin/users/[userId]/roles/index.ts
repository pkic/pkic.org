/**
 * GET  /api/v1/admin/users/:userId/roles — list a user's role assignments
 * POST /api/v1/admin/users/:userId/roles — assign a role to a user
 *
 * Backs `user_roles` (PRD §2.3) — a user may hold multiple roles
 * simultaneously (each independently context-scoped and time-bounded).
 */
import { OpenAPIRoute } from "chanfana";
import { parseJsonBody } from "../../../../../../_lib/validation";
import { json } from "../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../../_lib/auth/permissions";
import { all, first, run } from "../../../../../../_lib/db/queries";
import { nowIso } from "../../../../../../_lib/utils/time";
import { uuid } from "../../../../../../_lib/utils/ids";
import { writeAuditLog } from "../../../../../../_lib/services/audit";
import { AppError } from "../../../../../../_lib/errors";
import {
  userRoleAssignSchema,
  userRolesAssignRouteSchema,
  userRolesListRouteSchema,
} from "../../../../../../../assets/shared/schemas/access-control";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";

interface UserRoleRow {
  id: string;
  user_id: string;
  role_id: string;
  role_name: string;
  context_type: string | null;
  context_id: string | null;
  expires_at: string | null;
  created_at: string;
}

function serialize(row: UserRoleRow) {
  return {
    id: row.id,
    userId: row.user_id,
    roleId: row.role_id,
    roleName: row.role_name,
    contextType: row.context_type,
    contextId: row.context_id,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "access:grant");

  const rows = await all<UserRoleRow>(
    requestDb(c),
    `SELECT ur.id, ur.user_id, ur.role_id, r.name AS role_name, ur.context_type, ur.context_id, ur.expires_at, ur.created_at
     FROM user_roles ur
     JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id = ? AND ur.revoked_at IS NULL
     ORDER BY ur.created_at DESC`,
    [c.req.param("userId")],
  );

  return json({ roles: rows.map(serialize) });
}

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "access:grant");

  const userId = c.req.param("userId");
  const body = await parseJsonBody(c.req, userRoleAssignSchema);

  const userRow = await first<{ id: string }>(requestDb(c), "SELECT id FROM users WHERE id = ?", [userId]);
  if (!userRow) {
    throw new AppError(404, "USER_NOT_FOUND", "User not found");
  }

  const role = await first<{ id: string; name: string }>(requestDb(c), "SELECT id, name FROM roles WHERE id = ?", [
    body.roleId,
  ]);
  if (!role) {
    throw new AppError(404, "ROLE_NOT_FOUND", "Role not found");
  }

  const id = uuid();
  const now = nowIso();
  const contextType = body.contextType ?? null;
  const contextId = body.contextId ?? null;
  const expiresAt = body.expiresAt ?? null;

  await run(
    requestDb(c),
    `INSERT INTO user_roles (id, user_id, role_id, context_type, context_id, granted_by_user_id, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, body.roleId, contextType, contextId, admin.id, expiresAt, now],
  );

  await writeAuditLog(requestDb(c), "admin", admin.id, "user_role_assigned", "user_roles", id, {
    userId,
    roleId: body.roleId,
    roleName: role.name,
    contextType,
    contextId,
    expiresAt,
  });

  return json(
    {
      role: {
        id,
        userId,
        roleId: body.roleId,
        roleName: role.name,
        contextType,
        contextId,
        expiresAt,
        createdAt: now,
      },
    },
    201,
  );
}

export class UserRolesList extends OpenAPIRoute {
  schema = userRolesListRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestGet(c);
  }
}

export class UserRolesAssign extends OpenAPIRoute {
  schema = userRolesAssignRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestPost(c);
  }
}
