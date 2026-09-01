import {
  ROLE_ASSIGNMENT_HOLDERS_SORT_COLUMNS,
  USER_ROLE_ASSIGNMENTS_SORT_COLUMNS,
  SYSTEM_ROLE_IDS,
  roleAssignmentSchema,
  type RoleAssignment,
  type RoleAssignmentsListQuery,
  type UserRolesListQuery,
  userRoleResponseSchema,
  type UserRoleAssignment,
  type UserRoleAssignInput,
  type UserRoleUpdateExpiryInput,
} from "../../../../assets/shared/schemas/access-control";
import { buildPageInfo, type PageInfo } from "../../../../assets/shared/schemas/pagination";
import { AppError } from "../../errors";
import { hasPermission, requirePermission } from "../../auth/permissions";
import { adminDatabaseUserId } from "../../auth/admin-identity";
import { all, first } from "../../db/queries";
import { queryPage } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import { nowIso } from "../../utils/time";
import { uuid } from "../../utils/ids";
import { prepareAuditLog, prepareAuditLogAfterOneChange } from "../audit";
import { commitAccessControlMutation, requireAccessControlRead } from "./authorization";
import { buildAssignRepresentativeRoleStatements, isRepresentativeRoleId } from "../membership/representative-roles";
import {
  prepareOrganizationIdentityManagementGuard,
  requireOrganizationIdentityManagement,
} from "../identities/authorization";
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

const USER_ROLE_ASSIGNMENT_SORT_EXPRESSIONS: Record<(typeof USER_ROLE_ASSIGNMENTS_SORT_COLUMNS)[number], string> = {
  role_name: "LOWER(r.name)",
  context_type: "ur.context_type",
  context_id: "ur.context_id",
  expires_at: "ur.expires_at",
  created_at: "ur.created_at",
};

const ROLE_ASSIGNMENT_HOLDER_NAME_EXPRESSION =
  "CASE WHEN TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) = '' " +
  "THEN u.email ELSE TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) END";

const ROLE_ASSIGNMENT_HOLDER_SORT_EXPRESSIONS: Record<(typeof ROLE_ASSIGNMENT_HOLDERS_SORT_COLUMNS)[number], string> = {
  name: `LOWER(${ROLE_ASSIGNMENT_HOLDER_NAME_EXPRESSION})`,
  email: "LOWER(u.email)",
  context_type: "ur.context_type",
  context_id: "ur.context_id",
  expires_at: "ur.expires_at",
  created_at: "ur.created_at",
};

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

async function getNonRevokedAssignment(
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

async function prepareSemanticRoleManagementGuards(
  db: DatabaseLike,
  actor: AuthAdmin,
  roleId: string,
  contextType: string | null,
  contextId: string | null,
): Promise<StatementLike[]> {
  if (!isRepresentativeRoleId(roleId)) return [];
  if (contextType !== "organization" || !contextId) {
    throw new AppError(
      409,
      "REPRESENTATIVE_ROLE_CONTEXT_INVALID",
      "Stored representative roles must have an organization context",
    );
  }
  const authorization = {
    memberId: contextId,
    actorUserId: actor.id,
    databaseUserId: adminDatabaseUserId(actor),
    staffAuthorized: true,
  } as const;
  await requireOrganizationIdentityManagement(db, authorization);
  return [prepareOrganizationIdentityManagementGuard(db, authorization)];
}

export async function listUserRoleAssignments(
  db: DatabaseLike,
  actor: AuthAdmin,
  userId: string,
  query: UserRolesListQuery,
): Promise<{ roles: UserRoleAssignment[]; page: PageInfo }> {
  requireAccessControlRead(actor);
  const search = query.q ? buildD1TextSearchFilter(query.q, ["r.name", "ur.context_type", "ur.context_id"]) : null;
  const { rows, total } = await queryPage<UserRoleRow>(db, {
    sql: `SELECT ur.id, ur.user_id, ur.role_id, r.name AS role_name, ur.context_type, ur.context_id, ur.expires_at, ur.created_at
       FROM user_roles ur JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = ? AND ur.revoked_at IS NULL${search ? ` AND ${search.sql}` : ""}`,
    bindings: [userId, ...(search?.bindings ?? [])],
    orderBy: resolveMappedOrderBy(query.sort, USER_ROLE_ASSIGNMENT_SORT_EXPRESSIONS, "ur.created_at DESC", "ur.id ASC"),
    limit: query.limit,
    offset: query.offset,
  });
  const roles = rows.map(serialize);
  return { roles, page: buildPageInfo(query.limit, query.offset, total, roles.length) };
}

export async function listActiveRoleAssignmentHolders(
  db: DatabaseLike,
  actor: AuthAdmin,
  roleId: string,
  query: RoleAssignmentsListQuery,
): Promise<{ assignments: RoleAssignment[]; page: PageInfo }> {
  requireAccessControlRead(actor);
  if (!(await first<{ id: string }>(db, "SELECT id FROM roles WHERE id = ?", [roleId]))) {
    throw new AppError(404, "NOT_FOUND", "Role not found");
  }
  const search = query.q
    ? buildD1TextSearchFilter(query.q, [
        ROLE_ASSIGNMENT_HOLDER_NAME_EXPRESSION,
        "u.email",
        "ur.context_type",
        "ur.context_id",
      ])
    : null;
  const { rows, total } = await queryPage<RoleAssignmentHolderRow>(db, {
    sql: `SELECT ur.id AS user_role_id, u.id AS user_id, u.first_name, u.last_name, u.email,
            ur.context_type, ur.context_id, ur.expires_at, ur.created_at
     FROM user_roles ur
     JOIN users u ON u.id = ur.user_id
     WHERE ur.role_id = ?
       AND ur.revoked_at IS NULL
       AND (ur.expires_at IS NULL OR ur.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ${search ? `AND ${search.sql}` : ""}`,
    bindings: [roleId, ...(search?.bindings ?? [])],
    orderBy: resolveMappedOrderBy(
      query.sort,
      ROLE_ASSIGNMENT_HOLDER_SORT_EXPRESSIONS,
      "ur.created_at DESC",
      "ur.id ASC",
    ),
    limit: query.limit,
    offset: query.offset,
  });
  const assignments = rows.map(serializeHolder);
  return { assignments, page: buildPageInfo(query.limit, query.offset, total, assignments.length) };
}

function serializeHolder(row: RoleAssignmentHolderRow) {
  return roleAssignmentSchema.parse({
    userRoleId: row.user_role_id,
    userId: row.user_id,
    name: [row.first_name, row.last_name].filter(Boolean).join(" ") || row.email,
    email: row.email,
    contextType: row.context_type,
    contextId: row.context_id,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  });
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

  if (input.roleId === SYSTEM_ROLE_IDS.groupLead || input.roleId === SYSTEM_ROLE_IDS.groupDeputyLead) {
    throw new AppError(
      422,
      "GROUP_LEADERSHIP_REQUIRES_MEMBER_CAPACITY",
      "Assign group leadership through the group's Leadership resource with an explicit Member capacity",
    );
  }

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
      ...(await prepareSemanticRoleManagementGuards(db, actor, input.roleId, contextType, contextId)),
      ...(await buildAssignRepresentativeRoleStatements(db, {
        memberId: contextId,
        userId,
        roleId: input.roleId,
        grantedByUserId: adminDatabaseUserId(actor),
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
          adminDatabaseUserId(actor),
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
  await commitAccessControlMutation(
    db,
    actor,
    [
      { permission: "access:grant" },
      ...bundledPermissions.map(({ permission }) => (context ? { permission, context } : { permission })),
    ],
    statements,
  );

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
  const row = await getNonRevokedAssignment(db, userId, assignmentId);
  if (!row) throw new AppError(404, "NOT_FOUND", "Role assignment not found");
  const now = nowIso();
  const semanticGuards = await prepareSemanticRoleManagementGuards(
    db,
    actor,
    row.role_id,
    row.context_type,
    row.context_id,
  );
  const retiresLegacyAdminAuthority =
    row.role_id === SYSTEM_ROLE_IDS.admin && row.context_type === null && row.context_id === null;
  await commitAccessControlMutation(
    db,
    actor,
    [{ permission: "access:revoke" }],
    [
      ...semanticGuards,
      ...(retiresLegacyAdminAuthority
        ? [
            db
              .prepare("UPDATE users SET role = 'user', updated_at = ? WHERE id = ? AND role = 'admin'")
              .bind(now, userId),
            db.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(now, userId),
          ]
        : []),
      db.prepare("UPDATE user_roles SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").bind(now, row.id),
      prepareAuditLogAfterOneChange(
        db,
        "admin",
        actor.id,
        "user_role_revoked",
        "user_roles",
        row.id,
        { userId, roleId: row.role_id, retiredLegacyAdminAuthority: retiresLegacyAdminAuthority },
        now,
      ),
    ],
  );
}

export async function updateUserRoleAssignmentExpiry(
  db: DatabaseLike,
  actor: AuthAdmin,
  userId: string,
  assignmentId: string,
  input: UserRoleUpdateExpiryInput,
): Promise<UserRoleAssignment> {
  requirePermission(actor, "access:grant");
  const row = await getNonRevokedAssignment(db, userId, assignmentId);
  if (!row) throw new AppError(404, "NOT_FOUND", "Role assignment not found");
  if (isRepresentativeRoleId(row.role_id) && input.expiresAt !== null) {
    throw new AppError(
      422,
      "REPRESENTATIVE_ROLE_NO_EXPIRY",
      "Representative roles cannot be assigned an expiry through this endpoint",
    );
  }
  const context = row.context_type && row.context_id ? { type: row.context_type, id: row.context_id } : undefined;
  const bundledPermissions = await all<{ permission: string }>(
    db,
    "SELECT permission FROM role_permissions WHERE role_id = ?",
    [row.role_id],
  );
  for (const { permission } of bundledPermissions) {
    if (!hasPermission(actor, permission, context)) {
      throw new AppError(
        403,
        "PERMISSION_REQUIRED",
        `Cannot update a role assignment bundling a permission you do not hold: ${permission}`,
      );
    }
  }
  const semanticGuards = await prepareSemanticRoleManagementGuards(
    db,
    actor,
    row.role_id,
    row.context_type,
    row.context_id,
  );
  const now = nowIso();
  await commitAccessControlMutation(
    db,
    actor,
    [
      { permission: "access:grant" },
      ...bundledPermissions.map(({ permission }) => (context ? { permission, context } : { permission })),
    ],
    [
      ...semanticGuards,
      db
        .prepare(
          `UPDATE user_roles SET expires_at = ?
            WHERE id = ? AND revoked_at IS NULL
              AND ((expires_at IS NULL AND ? IS NULL) OR expires_at = ?)`,
        )
        .bind(input.expiresAt, row.id, row.expires_at, row.expires_at),
      prepareAuditLogAfterOneChange(
        db,
        "admin",
        actor.id,
        "user_role_expiry_updated",
        "user_roles",
        row.id,
        { userId, roleId: row.role_id, expiresAt: input.expiresAt },
        now,
      ),
    ],
  );
  return serialize({ ...row, expires_at: input.expiresAt });
}
