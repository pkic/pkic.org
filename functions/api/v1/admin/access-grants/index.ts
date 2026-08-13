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
import { all, first, run } from "../../../../_lib/db/queries";
import { nowIso } from "../../../../_lib/utils/time";
import { uuid } from "../../../../_lib/utils/ids";
import { writeAuditLog } from "../../../../_lib/services/audit";
import { AppError } from "../../../../_lib/errors";
import { resolveOrderBy } from "../../../../_lib/db/sort";
import {
  accessGrantsCreateRouteSchema,
  accessGrantsListQuerySchema,
  accessGrantsListRouteSchema,
  ADMIN_ACCESS_GRANTS_SORT_COLUMNS,
} from "../../../../../assets/shared/schemas/access-control";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";

interface GrantRow {
  id: string;
  user_id: string;
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
    permission: row.permission,
    contextType: row.context_type,
    contextId: row.context_id,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

export const AccessGrantsList = openApiRoute(accessGrantsListRouteSchema, async (c: AdminContext, _data) => {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  if (!hasPermission(admin, "access:grant") && !hasPermission(admin, "access:revoke")) {
    requirePermission(admin, "access:grant");
  }

  // userId isn't part of the declared query schema (it's a free-form
  // filter, not a sort/shape concern), and the invalid-sort fallback below
  // intentionally differs from strict schema rejection — same "quietly
  // ignore" behavior admin-organizations.ts's route uses — so this query
  // parsing stays manual rather than switching to `data.query`.
  const url = new URL(c.req.raw.url);
  const userId = url.searchParams.get("userId");
  // An invalid sort value fails schema validation (unknown column), so
  // `parsed.success` is false and we just fall back to the default order —
  // same "quietly ignore" behavior admin-organizations.ts's route uses.
  const parsed = accessGrantsListQuerySchema.safeParse({ sort: url.searchParams.get("sort") ?? undefined });
  const sort = parsed.success ? parsed.data.sort : undefined;
  const orderBy = resolveOrderBy(sort, ADMIN_ACCESS_GRANTS_SORT_COLUMNS, "ORDER BY created_at DESC");

  const rows = userId
    ? await all<GrantRow>(
        requestDb(c),
        `SELECT id, user_id, permission, context_type, context_id, expires_at, created_at
         FROM permission_grants WHERE user_id = ? AND revoked_at IS NULL ${orderBy}`,
        [userId],
      )
    : await all<GrantRow>(
        requestDb(c),
        `SELECT id, user_id, permission, context_type, context_id, expires_at, created_at
         FROM permission_grants WHERE revoked_at IS NULL ${orderBy}`,
      );

  return json({ grants: rows.map(serializeGrant) });
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

  const userRow = await first<{ id: string }>(requestDb(c), "SELECT id FROM users WHERE id = ?", [body.userId]);
  if (!userRow) {
    throw new AppError(404, "USER_NOT_FOUND", "User not found");
  }

  const id = uuid();
  const now = nowIso();
  const contextType = body.contextType ?? null;
  const contextId = body.contextId ?? null;
  const expiresAt = body.expiresAt ?? null;

  await run(
    requestDb(c),
    `INSERT INTO permission_grants (id, user_id, permission, context_type, context_id, granted_by_user_id, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, body.userId, body.permission, contextType, contextId, admin.id, expiresAt, now],
  );

  await writeAuditLog(requestDb(c), "admin", admin.id, "access_grant_created", "permission_grant", id, {
    userId: body.userId,
    permission: body.permission,
    contextType,
    contextId,
    expiresAt,
  });

  return json(
    {
      grant: {
        id,
        userId: body.userId,
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
