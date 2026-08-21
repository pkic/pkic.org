import {
  userRoleResponseSchema,
  type UserRoleAssignment,
  type UserRoleAssignInput,
  type UserRoleUpdateExpiryInput,
} from "../../../../assets/shared/schemas/access-control";
import { AppError } from "../../errors";
import { hasPermission, requirePermission } from "../../auth/permissions";
import { all, first } from "../../db/queries";
import { nowIso } from "../../utils/time";
import { uuid } from "../../utils/ids";
import { prepareAuditLog } from "../audit";
import { buildAssignRepresentativeRoleStatements, isRepresentativeRoleId } from "../membership/representative-roles";
import type { AuthAdmin, DatabaseLike, StatementLike } from "../../types";

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

interface RoleAssignmentHolderRow {
  user_role_id: string;
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  context_type: string | null;
  context_id: string | null;
  expires_at: string | null;
  created_at: string;
}

function serialize(row: UserRoleRow): UserRoleAssignment {
  return userRoleResponseSchema.parse({
    id: row.id,
    userId: row.user_id,
    roleId: row.role_id,
    roleName: row.role_name,
    contextType: row.context_type,
    contextId: row.context_id,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  });
}

async function getActiveAssignment(
  db: DatabaseLike,
  userId: string,
  assignmentId: string,
): Promise<UserRoleRow | null> {
  return first<UserRoleRow>(
    db,
    `SELECT ur.id, ur.user_id, ur.role_id, r.name AS role_name, ur.context_type, ur.context_id, ur.expires_at, ur.created_at
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
      WHERE ur.id = ? AND ur.user_id = ? AND ur.revoked_at IS NULL`,
    [assignmentId, userId],
  );
}

export async function listUserRoleAssignments(
  db: DatabaseLike,
  actor: AuthAdmin,
  userId: string,
): Promise<UserRoleAssignment[]> {
  requirePermission(actor, "access:grant");
  const rows = await all<UserRoleRow>(
    db,
    `SELECT ur.id, ur.user_id, ur.role_id, r.name AS role_name, ur.context_type, ur.context_id, ur.expires_at, ur.created_at
       FROM user_roles ur JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = ? AND ur.revoked_at IS NULL
      ORDER BY ur.created_at DESC, ur.id ASC`,
    [userId],
  );
  return rows.map(serialize);
}

export async function listActiveRoleAssignmentHolders(db: DatabaseLike, actor: AuthAdmin, roleId: string) {
  requirePermission(actor, "access:grant");
  if (!(await first<{ id: string }>(db, "SELECT id FROM roles WHERE id = ?", [roleId]))) {
    throw new AppError(404, "NOT_FOUND", "Role not found");
  }
  const rows = await all<RoleAssignmentHolderRow>(
    db,
    `SELECT ur.id AS user_role_id, u.id AS user_id, u.first_name, u.last_name, u.email,
            ur.context_type, ur.context_id, ur.expires_at, ur.created_at
     FROM user_roles ur
     JOIN users u ON u.id = ur.user_id
     WHERE ur.role_id = ?
       AND ur.revoked_at IS NULL
       AND (ur.expires_at IS NULL OR ur.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ORDER BY ur.created_at DESC`,
    [roleId],
  );
  return rows.map((row) => ({
    userRoleId: row.user_role_id,
    userId: row.user_id,
    name: [row.first_name, row.last_name].filter(Boolean).join(" ") || row.email,
    email: row.email,
    contextType: row.context_type,
    contextId: row.context_id,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  }));
}

export async function assignUserRole(
  db: DatabaseLike,
  actor: AuthAdmin,
  userId: string,
  input: UserRoleAssignInput,
): Promise<UserRoleAssignment> {
  requirePermission(actor, "access:grant");
  if (!(await first<{ id: string }>(db, "SELECT id FROM users WHERE id = ?", [userId]))) {
    throw new AppError(404, "USER_NOT_FOUND", "User not found");
  }
  const role = await first<{ id: string; name: string; single_holder_per_context: number }>(
    db,
    "SELECT id, name, single_holder_per_context FROM roles WHERE id = ?",
    [input.roleId],
  );
  if (!role) throw new AppError(404, "ROLE_NOT_FOUND", "Role not found");

  const contextType = input.contextType ?? null;
  const contextId = input.contextId ?? null;
  const context = contextType && contextId ? { type: contextType, id: contextId } : undefined;
  const bundledPermissions = await all<{ permission: string }>(
    db,
    "SELECT permission FROM role_permissions WHERE role_id = ?",
    [role.id],
  );
  for (const { permission } of bundledPermissions) {
    if (!hasPermission(actor, permission, context)) {
      throw new AppError(
        403,
        "PERMISSION_REQUIRED",
        `Cannot grant a role bundling a permission you do not hold: ${permission}`,
      );
    }
  }

  const now = nowIso();
  const expiresAt = input.expiresAt ?? null;
  const id = uuid();
  const statements: StatementLike[] = [];
  if (isRepresentativeRoleId(input.roleId)) {
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
    statements.push(
      ...(await buildAssignRepresentativeRoleStatements(db, {
        memberId: contextId,
        userId,
        roleId: input.roleId,
        grantedByUserId: actor.id,
        assignmentId: id,
        now,
      })),
    );
  } else {
    if (role.single_holder_per_context === 1 && contextType && contextId) {
      statements.push(
        db
          .prepare(
            `UPDATE user_roles SET revoked_at = ?
              WHERE context_type = ? AND context_id = ? AND role_id = ? AND revoked_at IS NULL`,
          )
          .bind(now, contextType, contextId, input.roleId),
      );
    }
    statements.push(
      db
        .prepare(
          `INSERT INTO user_roles
             (id, user_id, role_id, context_type, context_id, granted_by_user_id, single_holder_per_context, expires_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          userId,
          input.roleId,
          contextType,
          contextId,
          actor.id,
          role.single_holder_per_context,
          expiresAt,
          now,
        ),
    );
  }
  statements.push(
    prepareAuditLog(
      db,
      "admin",
      actor.id,
      "user_role_assigned",
      "user_roles",
      id,
      {
        userId,
        roleId: input.roleId,
        roleName: role.name,
        contextType,
        contextId,
        expiresAt: isRepresentativeRoleId(input.roleId) ? null : expiresAt,
      },
      now,
    ),
  );
  await db.batch(statements);

  return userRoleResponseSchema.parse({
    id,
    userId,
    roleId: input.roleId,
    roleName: role.name,
    contextType,
    contextId,
    expiresAt: isRepresentativeRoleId(input.roleId) ? null : expiresAt,
    createdAt: now,
  });
}

export async function revokeUserRoleAssignment(
  db: DatabaseLike,
  actor: AuthAdmin,
  userId: string,
  assignmentId: string,
): Promise<void> {
  requirePermission(actor, "access:revoke");
  const row = await getActiveAssignment(db, userId, assignmentId);
  if (!row) throw new AppError(404, "NOT_FOUND", "Role assignment not found");
  const now = nowIso();
  await db.batch([
    db.prepare("UPDATE user_roles SET revoked_at = ? WHERE id = ?").bind(now, row.id),
    prepareAuditLog(
      db,
      "admin",
      actor.id,
      "user_role_revoked",
      "user_roles",
      row.id,
      { userId, roleId: row.role_id },
      now,
    ),
  ]);
}

export async function updateUserRoleAssignmentExpiry(
  db: DatabaseLike,
  actor: AuthAdmin,
  userId: string,
  assignmentId: string,
  input: UserRoleUpdateExpiryInput,
): Promise<UserRoleAssignment> {
  requirePermission(actor, "access:grant");
  const row = await getActiveAssignment(db, userId, assignmentId);
  if (!row) throw new AppError(404, "NOT_FOUND", "Role assignment not found");
  const now = nowIso();
  await db.batch([
    db.prepare("UPDATE user_roles SET expires_at = ? WHERE id = ?").bind(input.expiresAt, row.id),
    prepareAuditLog(
      db,
      "admin",
      actor.id,
      "user_role_expiry_updated",
      "user_roles",
      row.id,
      { userId, roleId: row.role_id, expiresAt: input.expiresAt },
      now,
    ),
  ]);
  return serialize({ ...row, expires_at: input.expiresAt });
}
