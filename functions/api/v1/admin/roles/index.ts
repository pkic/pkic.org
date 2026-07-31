/**
 * GET  /api/v1/admin/roles — list roles with their permission bundles
 * POST /api/v1/admin/roles — create a custom role
 *
 * Backs `roles`/`role_permissions` (PRD §2.2/§2.3). Built-in roles
 * (`is_system_role = 1`) ship with the portal and cannot be deleted, but
 * per §2.2 their bundles "can be customized by an admin as the portal
 * evolves" — that customization isn't a separate endpoint here; an admin
 * edits a built-in role's bundle the same way as a custom one would be
 * managed going forward (out of Phase 2's explicit test scope — only
 * creation and deletion are covered by §10.4's tests/roles.test.ts).
 */
import { OpenAPIRoute } from "chanfana";
import { parseJsonBody } from "../../../../_lib/validation";
import { json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { requirePermission, isPermission } from "../../../../_lib/auth/permissions";
import { all, first, run } from "../../../../_lib/db/queries";
import { nowIso } from "../../../../_lib/utils/time";
import { uuid } from "../../../../_lib/utils/ids";
import { writeAuditLog } from "../../../../_lib/services/audit";
import { AppError } from "../../../../_lib/errors";
import { resolveOrderBy } from "../../../../_lib/db/sort";
import {
  roleCreateSchema,
  rolesCreateRouteSchema,
  rolesListQuerySchema,
  rolesListRouteSchema,
  ADMIN_ROLES_SORT_COLUMNS,
} from "../../../../../assets/shared/schemas/access-control";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";

interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  is_system_role: number;
  created_at: string;
}

interface RolePermissionRow {
  role_id: string;
  permission: string;
}

async function serializeRoles(dbRoles: RoleRow[], permissionsByRole: Map<string, string[]>) {
  return dbRoles.map((role) => ({
    id: role.id,
    name: role.name,
    description: role.description,
    isSystemRole: role.is_system_role === 1,
    permissions: permissionsByRole.get(role.id) ?? [],
    createdAt: role.created_at,
  }));
}

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "access:grant");

  const url = new URL(c.req.raw.url);
  // An invalid sort value fails schema validation (unknown column), so
  // `parsed.success` is false and we just fall back to the default order —
  // same "quietly ignore" behavior admin-organizations.ts's route uses.
  const parsed = rolesListQuerySchema.safeParse({ sort: url.searchParams.get("sort") ?? undefined });
  const sort = parsed.success ? parsed.data.sort : undefined;
  const orderBy = resolveOrderBy(sort, ADMIN_ROLES_SORT_COLUMNS, "ORDER BY name ASC");

  const [roles, permissionRows] = await Promise.all([
    all<RoleRow>(requestDb(c), `SELECT id, name, description, is_system_role, created_at FROM roles ${orderBy}`),
    all<RolePermissionRow>(requestDb(c), "SELECT role_id, permission FROM role_permissions ORDER BY permission ASC"),
  ]);

  const permissionsByRole = new Map<string, string[]>();
  for (const row of permissionRows) {
    const list = permissionsByRole.get(row.role_id) ?? [];
    list.push(row.permission);
    permissionsByRole.set(row.role_id, list);
  }

  return json({ roles: await serializeRoles(roles, permissionsByRole) });
}

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "access:grant");

  const body = await parseJsonBody(c.req, roleCreateSchema);

  for (const permission of body.permissions) {
    if (!isPermission(permission)) {
      throw new AppError(400, "INVALID_PERMISSION", `Unknown permission: ${permission}`);
    }
  }

  const existing = await first<{ id: string }>(requestDb(c), "SELECT id FROM roles WHERE name = ?", [body.name]);
  if (existing) {
    return json({ error: { code: "DUPLICATE", message: "A role with this name already exists" } }, 409);
  }

  const id = uuid();
  const now = nowIso();

  await run(
    requestDb(c),
    "INSERT INTO roles (id, name, description, is_system_role, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)",
    [id, body.name, body.description ?? null, now, now],
  );

  for (const permission of body.permissions) {
    await run(requestDb(c), "INSERT INTO role_permissions (id, role_id, permission, created_at) VALUES (?, ?, ?, ?)", [
      uuid(),
      id,
      permission,
      now,
    ]);
  }

  await writeAuditLog(requestDb(c), "admin", admin.id, "role_created", "role", id, {
    name: body.name,
    permissions: body.permissions,
  });

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
}

export class RolesList extends OpenAPIRoute {
  schema = rolesListRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestGet(c);
  }
}

export class RolesCreate extends OpenAPIRoute {
  schema = rolesCreateRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestPost(c);
  }
}
