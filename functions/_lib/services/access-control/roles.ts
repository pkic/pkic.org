import {
  ADMIN_ROLES_SORT_COLUMNS,
  roleResponseSchema,
  type Role,
  type RoleCreateInput,
  type RolesListQuery,
} from "../../../../assets/shared/schemas/access-control";
import { buildPageInfo, type PageInfo } from "../../../../assets/shared/schemas/pagination";
import { AppError } from "../../errors";
import { hasPermission, isPermission, requirePermission } from "../../auth/permissions";
import { first } from "../../db/queries";
import { queryPage } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveOrderBy } from "../../db/sort";
import { parseJsonSafe } from "../../utils/json";
import { nowIso } from "../../utils/time";
import { uuid } from "../../utils/ids";
import { prepareAuditLog } from "../audit";
import type { AuthAdmin, DatabaseLike } from "../../types";

interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  is_system_role: number;
  created_at: string;
  permissions_json: string;
}

function serializeRole(row: RoleRow): Role {
  return roleResponseSchema.parse({
    id: row.id,
    name: row.name,
    description: row.description,
    isSystemRole: row.is_system_role === 1,
    permissions: parseJsonSafe<unknown>(row.permissions_json, []),
    createdAt: row.created_at,
  });
}

export async function listRoles(
  db: DatabaseLike,
  actor: AuthAdmin,
  query: RolesListQuery,
): Promise<{ roles: Role[]; page: PageInfo }> {
  requirePermission(actor, "access:grant");
  const { q, sort, limit, offset } = query;
  const orderBy = resolveOrderBy(sort, ADMIN_ROLES_SORT_COLUMNS, "ORDER BY name ASC", "id ASC");
  const search = q ? buildD1TextSearchFilter(q, ["name", "description"]) : null;
  const where = search ? `WHERE ${search.sql}` : "";
  const bindings = search?.bindings ?? [];
  const { rows, total } = await queryPage<RoleRow>(
    db,
    {
      sql: `SELECT r.id, r.name, r.description, r.is_system_role, r.created_at,
                   COALESCE(
                     (SELECT json_group_array(permission)
                        FROM (SELECT permission FROM role_permissions WHERE role_id = r.id ORDER BY permission ASC)),
                     '[]'
                   ) AS permissions_json
              FROM roles r ${where} ${orderBy} LIMIT ? OFFSET ?`,
      bindings: [...bindings, limit, offset],
    },
    { sql: `SELECT COUNT(*) AS total FROM roles ${where}`, bindings },
  );
  const roles = rows.map(serializeRole);
  return { roles, page: buildPageInfo(limit, offset, total, roles.length) };
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
  await db.batch([
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
  ]);

  return roleResponseSchema.parse({
    id,
    name: input.name,
    description: input.description ?? null,
    isSystemRole: false,
    permissions: input.permissions,
    createdAt: now,
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
  if (
    await first<{ id: string }>(db, "SELECT id FROM user_roles WHERE role_id = ? AND revoked_at IS NULL LIMIT 1", [
      role.id,
    ])
  ) {
    throw new AppError(409, "ROLE_IN_USE", "Role is still assigned to a user");
  }

  await db.batch([
    db.prepare("DELETE FROM role_permissions WHERE role_id = ?").bind(role.id),
    db.prepare("DELETE FROM roles WHERE id = ?").bind(role.id),
    prepareAuditLog(db, "admin", actor.id, "role_deleted", "role", role.id, { name: role.name }),
  ]);
}
