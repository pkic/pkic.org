/**
 * GET  /api/v1/admin/roles — list roles with their permission bundles
 * POST /api/v1/admin/roles — create a custom role
 *
 * Backs `roles`/`role_permissions`. Built-in roles
 * (`is_system_role = 1`) ship with the portal and cannot be deleted, but
 * their bundles "can be customized by an admin as the portal
 * evolves" — that customization isn't a separate endpoint here; an admin
 * edits a built-in role's bundle the same way as a custom one would be
 * managed going forward (explicit test scope — only
 * creation and deletion are covered by tests/roles.test.ts).
 */
import { json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { hasPermission, requirePermission, isPermission } from "../../../../_lib/auth/permissions";
import { first } from "../../../../_lib/db/queries";
import { queryPage } from "../../../../_lib/db/pagination";
import { buildD1TextSearchFilter } from "../../../../_lib/db/search";
import { nowIso } from "../../../../_lib/utils/time";
import { uuid } from "../../../../_lib/utils/ids";
import { prepareAuditLog } from "../../../../_lib/services/audit";
import { AppError } from "../../../../_lib/errors";
import { resolveOrderBy } from "../../../../_lib/db/sort";
import {
  rolesCreateRouteSchema,
  rolesListRouteSchema,
  ADMIN_ROLES_SORT_COLUMNS,
} from "../../../../../assets/shared/schemas/access-control";
import { buildPageInfo } from "../../../../../assets/shared/schemas/pagination";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";

interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  is_system_role: number;
  created_at: string;
  permissions_json: string;
}

export const RolesList = openApiRoute(rolesListRouteSchema, async (c: AdminContext, data) => {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "access:grant");

  // `data.query.sort` is already validated against ADMIN_ROLES_SORT_COLUMNS
  // by rolesListQuerySchema before this handler runs (openApiRoute's
  // getValidatedData); resolveOrderBy's own fallback-to-default handles an
  // omitted sort, same as every other admin list endpoint.
  const { q, sort, limit = 50, offset = 0 } = data.query;
  const orderBy = resolveOrderBy(sort, ADMIN_ROLES_SORT_COLUMNS, "ORDER BY name ASC");
  const search = q ? buildD1TextSearchFilter(q, ["name", "description"]) : null;
  const where = search ? `WHERE ${search.sql}` : "";
  const whereArgs = search?.bindings ?? [];

  const { rows, total } = await queryPage<RoleRow>(
    requestDb(c),
    {
      sql: `SELECT r.id, r.name, r.description, r.is_system_role, r.created_at,
                   COALESCE(
                     (SELECT json_group_array(permission)
                        FROM (SELECT permission
                                FROM role_permissions
                               WHERE role_id = r.id
                               ORDER BY permission ASC)),
                     '[]'
                   ) AS permissions_json
              FROM roles r
              ${where}
              ${orderBy}
             LIMIT ? OFFSET ?`,
      bindings: [...whereArgs, limit, offset],
    },
    { sql: `SELECT COUNT(*) AS total FROM roles ${where}`, bindings: whereArgs },
  );

  const roles = rows.map((role) => ({
    id: role.id,
    name: role.name,
    description: role.description,
    isSystemRole: role.is_system_role === 1,
    permissions: JSON.parse(role.permissions_json) as string[],
    createdAt: role.created_at,
  }));

  return json({
    roles,
    page: buildPageInfo(limit, offset, total, roles.length),
  });
});

export const RolesCreate = openApiRoute(rolesCreateRouteSchema, async (c: AdminContext, data) => {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "access:grant");

  const body = data.body;

  for (const permission of body.permissions) {
    if (!isPermission(permission)) {
      throw new AppError(400, "INVALID_PERMISSION", `Unknown permission: ${permission}`);
    }
    if (!hasPermission(admin, permission)) {
      throw new AppError(403, "PERMISSION_REQUIRED", `Cannot bundle a permission you do not hold: ${permission}`);
    }
  }

  const existing = await first<{ id: string }>(requestDb(c), "SELECT id FROM roles WHERE name = ?", [body.name]);
  if (existing) {
    return json({ error: { code: "DUPLICATE", message: "A role with this name already exists" } }, 409);
  }

  const id = uuid();
  const now = nowIso();

  await requestDb(c).batch([
    requestDb(c)
      .prepare(
        "INSERT INTO roles (id, name, description, is_system_role, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)",
      )
      .bind(id, body.name, body.description ?? null, now, now),
    ...body.permissions.map((permission) =>
      requestDb(c)
        .prepare("INSERT INTO role_permissions (id, role_id, permission, created_at) VALUES (?, ?, ?, ?)")
        .bind(uuid(), id, permission, now),
    ),
    prepareAuditLog(
      requestDb(c),
      "admin",
      admin.id,
      "role_created",
      "role",
      id,
      { name: body.name, permissions: body.permissions },
      now,
    ),
  ]);

  return json(
    {
      role: {
        id,
        name: body.name,
        description: body.description ?? null,
        isSystemRole: false,
        permissions: body.permissions,
        createdAt: now,
      },
    },
    201,
  );
});
