import {
  ROLES_SORT_COLUMNS,
  roleResponseSchema,
  type Role,
  type RoleCreateInput,
  type RolesListQuery,
  type RoleUpdateInput,
} from "../../../../assets/shared/schemas/access-control";
import { buildPageInfo, type PageInfo } from "../../../../assets/shared/schemas/pagination";
import { AppError } from "../../errors";
import { hasPermission, isPermission, requirePermission } from "../../auth/permissions";
import { all, first } from "../../db/queries";
import { queryPage } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveOrderBy } from "../../db/sort";
import { parseJsonSafe } from "../../utils/json";
import { nowIso } from "../../utils/time";
import { uuid } from "../../utils/ids";
import { prepareAuditLog, prepareAuditLogAfterOneChange } from "../audit";
import { commitAccessControlMutation, requireAccessControlRead } from "./authorization";
import type { AuthAdmin, DatabaseLike, StatementLike } from "../../types";

interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  is_system_role: number;
  created_at: string;
  updated_at: string;
  permissions_json: string;
}

const ROLE_SELECT_COLUMNS = `r.id, r.name, r.description, r.is_system_role, r.created_at, r.updated_at,
                   COALESCE(
                     (SELECT json_group_array(permission)
                        FROM (SELECT permission FROM role_permissions WHERE role_id = r.id ORDER BY permission ASC)),
                     '[]'
                   ) AS permissions_json`;

function serializeRole(row: RoleRow): Role {
  return roleResponseSchema.parse({
    id: row.id,
    name: row.name,
    description: row.description,
    isSystemRole: row.is_system_role === 1,
    permissions: parseJsonSafe<unknown>(row.permissions_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export async function listRoles(
  db: DatabaseLike,
  actor: AuthAdmin,
  query: RolesListQuery,
): Promise<{ roles: Role[]; page: PageInfo }> {
  requireAccessControlRead(actor);
  const { q, sort, limit, offset } = query;
  const orderBy = resolveOrderBy(sort, ROLES_SORT_COLUMNS, "ORDER BY name ASC", "id ASC");
  const search = q ? buildD1TextSearchFilter(q, ["name", "description"]) : null;
  const where = search ? `WHERE ${search.sql}` : "";
  const bindings = search?.bindings ?? [];
  const { rows, total } = await queryPage<RoleRow>(db, {
    sql: `SELECT ${ROLE_SELECT_COLUMNS} FROM roles r ${where}`,
    bindings,
    orderBy,
    limit,
    offset,
  });
  const roles = rows.map(serializeRole);
  return { roles, page: buildPageInfo(limit, offset, total, roles.length) };
}

export async function getRole(db: DatabaseLike, actor: AuthAdmin, roleId: string): Promise<Role> {
  requireAccessControlRead(actor);
  const row = await first<RoleRow>(db, `SELECT ${ROLE_SELECT_COLUMNS} FROM roles r WHERE r.id = ?`, [roleId]);
  if (!row) throw new AppError(404, "NOT_FOUND", "Role not found");
  return serializeRole(row);
}

export async function createRole(db: DatabaseLike, actor: AuthAdmin, input: RoleCreateInput): Promise<Role> {
  requirePermission(actor, "access:grant");
  for (const permission of input.permissions) {
    if (!isPermission(permission)) throw new AppError(400, "INVALID_PERMISSION", `Unknown permission: ${permission}`);
    if (!hasPermission(actor, permission)) {
      throw new AppError(403, "PERMISSION_REQUIRED", `Cannot bundle a permission you do not hold: ${permission}`);
    }
  }

  if (await first<{ id: string }>(db, "SELECT id FROM roles WHERE name = ?", [input.name])) {
    throw new AppError(409, "DUPLICATE", "A role with this name already exists");
  }

  const id = uuid();
  const now = nowIso();
  await commitAccessControlMutation(
    db,
    actor,
    [{ permission: "access:grant" }, ...input.permissions.map((permission) => ({ permission }))],
    [
      db
        .prepare(
          "INSERT INTO roles (id, name, description, is_system_role, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)",
        )
        .bind(id, input.name, input.description ?? null, now, now),
      ...input.permissions.map((permission) =>
        db
          .prepare("INSERT INTO role_permissions (id, role_id, permission, created_at) VALUES (?, ?, ?, ?)")
          .bind(uuid(), id, permission, now),
      ),
      prepareAuditLog(
        db,
        "admin",
        actor.id,
        "role_created",
        "role",
        id,
        { name: input.name, permissions: input.permissions },
        now,
      ),
    ],
  );

  return roleResponseSchema.parse({
    id,
    name: input.name,
    description: input.description ?? null,
    isSystemRole: false,
    permissions: input.permissions,
    createdAt: now,
    updatedAt: now,
  });
}

export async function updateRole(
  db: DatabaseLike,
  actor: AuthAdmin,
  roleId: string,
  input: RoleUpdateInput,
): Promise<Role> {
  requirePermission(actor, "access:grant");
  const existing = await first<{
    id: string;
    name: string;
    description: string | null;
    is_system_role: number;
    created_at: string;
  }>(db, "SELECT id, name, description, is_system_role, created_at FROM roles WHERE id = ?", [roleId]);
  if (!existing) throw new AppError(404, "NOT_FOUND", "Role not found");
  if (existing.is_system_role === 1) throw new AppError(409, "SYSTEM_ROLE", "System roles cannot be edited");

  if (input.permissions !== undefined) {
    for (const permission of input.permissions) {
      if (!isPermission(permission)) throw new AppError(400, "INVALID_PERMISSION", `Unknown permission: ${permission}`);
      if (!hasPermission(actor, permission)) {
        throw new AppError(403, "PERMISSION_REQUIRED", `Cannot bundle a permission you do not hold: ${permission}`);
      }
    }
  }

  if (input.name !== undefined && input.name !== existing.name) {
    if (await first<{ id: string }>(db, "SELECT id FROM roles WHERE name = ? AND id != ?", [input.name, roleId])) {
      throw new AppError(409, "DUPLICATE", "A role with this name already exists");
    }
  }

  const now = nowIso();
  const setClauses = ["updated_at = ?"];
  const values: unknown[] = [now];
  if (input.name !== undefined) {
    setClauses.push("name = ?");
    values.push(input.name);
  }
  if (input.description !== undefined) {
    setClauses.push("description = ?");
    values.push(input.description);
  }
  values.push(roleId, input.revision);

  // The UPDATE's `updated_at = ?` compare-and-swap is the concurrency guard;
  // the audit row immediately after it is only recorded when that UPDATE
  // actually touched a row, so a lost race between two edits never records a
  // false audit entry (mirrors updateUserRoleAssignmentExpiry in
  // user-role-assignments.ts).
  const statements: StatementLike[] = [
    db
      .prepare(`UPDATE roles SET ${setClauses.join(", ")} WHERE id = ? AND updated_at = ? AND is_system_role = 0`)
      .bind(...values),
    prepareAuditLogAfterOneChange(
      db,
      "admin",
      actor.id,
      "role_updated",
      "role",
      roleId,
      { name: input.name, description: input.description, permissions: input.permissions },
      now,
    ),
  ];

  if (input.permissions !== undefined) {
    statements.push(
      db.prepare("DELETE FROM role_permissions WHERE role_id = ?").bind(roleId),
      ...input.permissions.map((permission) =>
        db
          .prepare("INSERT INTO role_permissions (id, role_id, permission, created_at) VALUES (?, ?, ?, ?)")
          .bind(uuid(), roleId, permission, now),
      ),
    );
  }

  await commitAccessControlMutation(
    db,
    actor,
    [{ permission: "access:grant" }, ...(input.permissions ?? []).map((permission) => ({ permission }))],
    statements,
  );

  const permissions =
    input.permissions ??
    (
      await all<{ permission: string }>(
        db,
        "SELECT permission FROM role_permissions WHERE role_id = ? ORDER BY permission ASC",
        [roleId],
      )
    ).map((row) => row.permission);

  return roleResponseSchema.parse({
    id: roleId,
    name: input.name ?? existing.name,
    description: input.description !== undefined ? input.description : existing.description,
    isSystemRole: false,
    permissions,
    createdAt: existing.created_at,
    updatedAt: now,
  });
}

export async function deleteRole(db: DatabaseLike, actor: AuthAdmin, roleId: string): Promise<void> {
  requirePermission(actor, "access:revoke");
  const role = await first<{ id: string; name: string; is_system_role: number }>(
    db,
    "SELECT id, name, is_system_role FROM roles WHERE id = ?",
    [roleId],
  );
  if (!role) throw new AppError(404, "NOT_FOUND", "Role not found");
  if (role.is_system_role === 1) throw new AppError(409, "SYSTEM_ROLE", "System roles cannot be deleted");
  // user_roles deliberately retains revoked and expired assignment history,
  // and its role_id foreign key does not cascade. Reject deletion explicitly
  // instead of attempting a batch that fails with an opaque FK error.
  if (await first<{ id: string }>(db, "SELECT id FROM user_roles WHERE role_id = ? LIMIT 1", [role.id])) {
    throw new AppError(409, "ROLE_HAS_ASSIGNMENT_HISTORY", "Role has user assignment history and cannot be deleted");
  }

  await commitAccessControlMutation(
    db,
    actor,
    [{ permission: "access:revoke" }],
    [
      db.prepare("DELETE FROM role_permissions WHERE role_id = ?").bind(role.id),
      db.prepare("DELETE FROM roles WHERE id = ? AND is_system_role = 0").bind(role.id),
      prepareAuditLogAfterOneChange(db, "admin", actor.id, "role_deleted", "role", role.id, { name: role.name }),
    ],
  );
}
