/**
 * GET  /api/v1/admin/access-grants — list permission grants
 * POST /api/v1/admin/access-grants — create a permission grant
 *
 * Backs `permission_grants` — individual, ad-hoc permission
 * overrides, distinct from role-bundle assignment (see
 * functions/api/v1/admin/users/[userId]/roles.ts, which backs `user_roles`).
 * Gated by `access:grant`/`access:revoke` via the permission system
 * (functions/_lib/auth/permissions.ts), not the legacy AUTH_SCOPES system —
 * see the isPermissionGatedAdminPath bypass in admin/router.ts.
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
import { resolveMappedOrderBy } from "../../../../_lib/db/sort";
import {
  accessGrantsCreateRouteSchema,
  accessGrantsListRouteSchema,
  ADMIN_ACCESS_GRANTS_SORT_COLUMNS,
} from "../../../../../assets/shared/schemas/access-control";
import { buildPageInfo } from "../../../../../assets/shared/schemas/pagination";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";

interface GrantRow {
  id: string;
  user_id: string;
  user_email: string;
  permission: string;
  context_type: string | null;
  context_id: string | null;
  expires_at: string | null;
  created_at: string;
}

function serializeGrant(row: GrantRow) {
  return {
    id: row.id,
    userId: row.user_id,
    userEmail: row.user_email,
    permission: row.permission,
    contextType: row.context_type,
    contextId: row.context_id,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

export const AccessGrantsList = openApiRoute(accessGrantsListRouteSchema, async (c: AdminContext, data) => {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  if (!hasPermission(admin, "access:grant") && !hasPermission(admin, "access:revoke")) {
    requirePermission(admin, "access:grant");
  }

  const { userId, q, sort, limit = 50, offset = 0 } = data.query;
  const orderBy = resolveMappedOrderBy(
    sort,
    {
      user_id: "g.user_id",
      permission: "g.permission",
      context_type: "g.context_type",
      expires_at: "g.expires_at",
      created_at: "g.created_at",
    } satisfies Record<(typeof ADMIN_ACCESS_GRANTS_SORT_COLUMNS)[number], string>,
    "g.created_at DESC",
    "g.id ASC",
  );
  const conditions = ["g.revoked_at IS NULL"];
  const whereArgs: unknown[] = [];
  if (userId) {
    conditions.push("g.user_id = ?");
    whereArgs.push(userId);
  }
  if (q) {
    const search = buildD1TextSearchFilter(q, [
      "g.permission",
      "g.context_type",
      "g.context_id",
      "u.email",
      "u.first_name",
      "u.last_name",
    ]);
    conditions.push(search.sql);
    whereArgs.push(...search.bindings);
  }
  const where = `WHERE ${conditions.join(" AND ")}`;

  const { rows, total } = await queryPage<GrantRow>(
    requestDb(c),
    {
      sql: `SELECT g.id, g.user_id, u.email AS user_email, g.permission, g.context_type, g.context_id,
                   g.expires_at, g.created_at
              FROM permission_grants g
              JOIN users u ON u.id = g.user_id
              ${where} ${orderBy} LIMIT ? OFFSET ?`,
      bindings: [...whereArgs, limit, offset],
    },
    {
      sql: `SELECT COUNT(*) AS total FROM permission_grants g JOIN users u ON u.id = g.user_id ${where}`,
      bindings: whereArgs,
    },
  );

  return json({
    grants: rows.map(serializeGrant),
    page: buildPageInfo(limit, offset, total, rows.length),
  });
});

export const AccessGrantsCreate = openApiRoute(accessGrantsCreateRouteSchema, async (c: AdminContext, data) => {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "access:grant");

  const body = data.body;

  if (!isPermission(body.permission)) {
    throw new AppError(400, "INVALID_PERMISSION", `Unknown permission: ${body.permission}`);
  }

  const grantContext = body.contextType && body.contextId ? { type: body.contextType, id: body.contextId } : undefined;
  if (!hasPermission(admin, body.permission, grantContext)) {
    throw new AppError(403, "PERMISSION_REQUIRED", `Cannot grant a permission you do not hold: ${body.permission}`);
  }

  const userRow = await first<{ id: string; email: string }>(requestDb(c), "SELECT id, email FROM users WHERE id = ?", [
    body.userId,
  ]);
  if (!userRow) {
    throw new AppError(404, "USER_NOT_FOUND", "User not found");
  }

  const id = uuid();
  const now = nowIso();
  const contextType = body.contextType ?? null;
  const contextId = body.contextId ?? null;
  const expiresAt = body.expiresAt ?? null;

  await requestDb(c).batch([
    requestDb(c)
      .prepare(
        `INSERT INTO permission_grants (id, user_id, permission, context_type, context_id, granted_by_user_id, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, body.userId, body.permission, contextType, contextId, admin.id, expiresAt, now),
    prepareAuditLog(
      requestDb(c),
      "admin",
      admin.id,
      "access_grant_created",
      "permission_grant",
      id,
      { userId: body.userId, permission: body.permission, contextType, contextId, expiresAt },
      now,
    ),
  ]);

  return json(
    {
      grant: {
        id,
        userId: body.userId,
        userEmail: userRow.email,
        permission: body.permission,
        contextType,
        contextId,
        expiresAt,
        createdAt: now,
      },
    },
    201,
  );
});
