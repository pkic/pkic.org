/**
 * GET  /api/v1/admin/users/:userId/roles — list a user's role assignments
 * POST /api/v1/admin/users/:userId/roles — assign a role to a user
 *
 * Backs `user_roles` — a user may hold multiple roles
 * simultaneously (each independently context-scoped and time-bounded).
 */
import { json } from "../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../_lib/auth/admin";
import { hasPermission, requirePermission } from "../../../../../../_lib/auth/permissions";
import { all, first } from "../../../../../../_lib/db/queries";
import { nowIso } from "../../../../../../_lib/utils/time";
import { uuid } from "../../../../../../_lib/utils/ids";
import { prepareAuditLog } from "../../../../../../_lib/services/audit";
import { AppError } from "../../../../../../_lib/errors";
import {
  userRolesAssignRouteSchema,
  userRolesListRouteSchema,
} from "../../../../../../../assets/shared/schemas/access-control";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import {
  isRepresentativeRoleId,
  buildAssignRepresentativeRoleStatements,
} from "../../../../../../_lib/services/membership/representative-roles";
import type { StatementLike } from "../../../../../../_lib/types";

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

export const UserRolesList = openApiRoute(userRolesListRouteSchema, async (c: AdminContext, data) => {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "access:grant");

  const rows = await all<UserRoleRow>(
    requestDb(c),
    `SELECT ur.id, ur.user_id, ur.role_id, r.name AS role_name, ur.context_type, ur.context_id, ur.expires_at, ur.created_at
     FROM user_roles ur
     JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id = ? AND ur.revoked_at IS NULL
     ORDER BY ur.created_at DESC`,
    [data.params.userId],
  );

  return json({ roles: rows.map(serialize) });
});

export const UserRolesAssign = openApiRoute(userRolesAssignRouteSchema, async (c: AdminContext, data) => {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "access:grant");

  const userId = data.params.userId;
  const body = data.body;

  const userRow = await first<{ id: string }>(requestDb(c), "SELECT id FROM users WHERE id = ?", [userId]);
  if (!userRow) {
    throw new AppError(404, "USER_NOT_FOUND", "User not found");
  }

  const role = await first<{ id: string; name: string; single_holder_per_context: number }>(
    requestDb(c),
    "SELECT id, name, single_holder_per_context FROM roles WHERE id = ?",
    [body.roleId],
  );
  if (!role) {
    throw new AppError(404, "ROLE_NOT_FOUND", "Role not found");
  }

  const contextType = body.contextType ?? null;
  const contextId = body.contextId ?? null;
  const grantContext = contextType && contextId ? { type: contextType, id: contextId } : undefined;

  const bundledPermissions = await all<{ permission: string }>(
    requestDb(c),
    "SELECT permission FROM role_permissions WHERE role_id = ?",
    [role.id],
  );
  for (const { permission } of bundledPermissions) {
    if (!hasPermission(admin, permission, grantContext)) {
      throw new AppError(
        403,
        "PERMISSION_REQUIRED",
        `Cannot grant a role bundling a permission you do not hold: ${permission}`,
      );
    }
  }

  const now = nowIso();
  const expiresAt = body.expiresAt ?? null;

  // The three representative roles (primary/secondary contact, voting
  // delegate) are singleton-per-organization and carry a service-layer
  // invariant (the target user must actively represent the organization) —
  // a bare INSERT here would bypass both. Route those through the same
  // canonical service used by every other representative-role grant path
  // instead of duplicating the check inline. A representative role ID with
  // any other context (null, event, working_group, or organization without
  // a contextId) must be rejected outright — it must never reach the
  // generic single_holder_per_context path below, which has no concept of
  // "actively represents this organization" and would happily insert an
  // invalid grant.
  if (isRepresentativeRoleId(body.roleId)) {
    if (!(contextType === "organization" && contextId)) {
      throw new AppError(
        422,
        "REPRESENTATIVE_ROLE_REQUIRES_ORGANIZATION_CONTEXT",
        "Representative roles require contextType='organization' and a contextId",
      );
    }
    if (expiresAt) {
      throw new AppError(
        422,
        "REPRESENTATIVE_ROLE_NO_EXPIRY",
        "Representative roles cannot be granted with an expiry through this endpoint",
      );
    }

    const id = uuid();
    const statements = await buildAssignRepresentativeRoleStatements(requestDb(c), {
      memberId: contextId,
      userId,
      roleId: body.roleId,
      grantedByUserId: admin.id,
      assignmentId: id,
      now,
    });
    await requestDb(c).batch([
      ...statements,
      prepareAuditLog(
        requestDb(c),
        "admin",
        admin.id,
        "user_role_assigned",
        "user_roles",
        id,
        { userId, roleId: body.roleId, roleName: role.name, contextType, contextId, expiresAt: null },
        now,
      ),
    ]);

    return json(
      {
        role: {
          id,
          userId,
          roleId: body.roleId,
          roleName: role.name,
          contextType,
          contextId,
          expiresAt: null,
          createdAt: now,
        },
      },
      201,
    );
  }

  // Any other role marked single_holder_per_context=1 (not just the three
  // hardcoded representative roles) must still revoke the previous holder
  // atomically with the new insert, or uq_user_roles_single_holder_per_context
  // rejects the insert outright — this keeps the invariant general instead
  // of only correct for roles this route happens to know about by name.
  const id = uuid();
  const statements: StatementLike[] = [];
  if (role.single_holder_per_context === 1 && contextType && contextId) {
    statements.push(
      requestDb(c)
        .prepare(
          `UPDATE user_roles SET revoked_at = ?
           WHERE context_type = ? AND context_id = ? AND role_id = ? AND revoked_at IS NULL`,
        )
        .bind(now, contextType, contextId, body.roleId),
    );
  }
  statements.push(
    requestDb(c)
      .prepare(
        `INSERT INTO user_roles (id, user_id, role_id, context_type, context_id, granted_by_user_id, single_holder_per_context, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, userId, body.roleId, contextType, contextId, admin.id, role.single_holder_per_context, expiresAt, now),
    prepareAuditLog(
      requestDb(c),
      "admin",
      admin.id,
      "user_role_assigned",
      "user_roles",
      id,
      { userId, roleId: body.roleId, roleName: role.name, contextType, contextId, expiresAt },
      now,
    ),
  );
  await requestDb(c).batch(statements);

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
});
