import {
  ACCESS_GRANTS_SORT_COLUMNS,
  accessGrantResponseSchema,
  type AccessGrant,
  type AccessGrantCreateInput,
  type AccessGrantsListQuery,
} from "../../../../assets/shared/schemas/access-control";
import { buildPageInfo, type PageInfo } from "../../../../assets/shared/schemas/pagination";
import { AppError } from "../../errors";
import { hasPermission, isPermission, requirePermission } from "../../auth/permissions";
import { adminDatabaseUserId } from "../../auth/admin-identity";
import { first } from "../../db/queries";
import { queryPage } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import { nowIso } from "../../utils/time";
import { uuid } from "../../utils/ids";
import { prepareAuditLog, prepareAuditLogAfterOneChange } from "../audit";
import { commitAccessControlMutation, requireAccessControlRead } from "./authorization";
import type { AuthAdmin, DatabaseLike } from "../../types";

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

function isActiveAccessGrantConflict(error: unknown): boolean {
  return error instanceof Error && error.message.includes("uq_permission_grants_active_user_permission_context");
}

function serializeGrant(row: GrantRow): AccessGrant {
  return accessGrantResponseSchema.parse({
    id: row.id,
    userId: row.user_id,
    userEmail: row.user_email,
    permission: row.permission,
    contextType: row.context_type,
    contextId: row.context_id,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  });
}

export async function listAccessGrants(
  db: DatabaseLike,
  actor: AuthAdmin,
  query: AccessGrantsListQuery,
): Promise<{ grants: AccessGrant[]; page: PageInfo }> {
  requireAccessControlRead(actor);

  const { userId, q, sort, limit, offset } = query;
  const orderBy = resolveMappedOrderBy(
    sort,
    {
      user_id: "g.user_id",
      permission: "g.permission",
      context_type: "g.context_type",
      expires_at: "g.expires_at",
      created_at: "g.created_at",
    } satisfies Record<(typeof ACCESS_GRANTS_SORT_COLUMNS)[number], string>,
    "g.created_at DESC",
    "g.id ASC",
  );
  const conditions = ["g.revoked_at IS NULL"];
  const bindings: unknown[] = [];
  if (userId) {
    conditions.push("g.user_id = ?");
    bindings.push(userId);
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
    bindings.push(...search.bindings);
  }
  const where = `WHERE ${conditions.join(" AND ")}`;

  const { rows, total } = await queryPage<GrantRow>(db, {
    sql: `SELECT g.id, g.user_id, u.email AS user_email, g.permission, g.context_type, g.context_id,
                   g.expires_at, g.created_at
              FROM permission_grants g
              JOIN users u ON u.id = g.user_id
              ${where}`,
    bindings,
    orderBy,
    limit,
    offset,
  });
  const grants = rows.map(serializeGrant);
  return { grants, page: buildPageInfo(limit, offset, total, grants.length) };
}

/** Grants each chosen permission to one person for one target, in a single command: all are created or none is. */
export async function createAccessGrants(
  db: DatabaseLike,
  actor: AuthAdmin,
  input: AccessGrantCreateInput,
): Promise<AccessGrant[]> {
  requirePermission(actor, "access:grant");
  const permissions = [...new Set(input.permissions)];
  const context = input.contextType && input.contextId ? { type: input.contextType, id: input.contextId } : undefined;
  for (const permission of permissions) {
    if (!isPermission(permission)) throw new AppError(400, "INVALID_PERMISSION", `Unknown permission: ${permission}`);
    if (!hasPermission(actor, permission, context))
      throw new AppError(403, "PERMISSION_REQUIRED", `Cannot grant a permission you do not hold: ${permission}`);
  }

  const user = await first<{ id: string; email: string }>(db, "SELECT id, email FROM users WHERE id = ?", [
    input.userId,
  ]);
  if (!user) throw new AppError(404, "USER_NOT_FOUND", "User not found");

  const now = nowIso();
  const contextType = input.contextType ?? null;
  const contextId = input.contextId ?? null;
  const expiresAt = input.expiresAt ?? null;
  const grants = permissions.map((permission) => ({ id: uuid(), permission }));
  try {
    await commitAccessControlMutation(
      db,
      actor,
      [
        { permission: "access:grant" },
        ...permissions.map((permission) => (context ? { permission, context } : { permission })),
      ],
      grants.flatMap(({ id, permission }) => [
        db
          .prepare(
            `INSERT INTO permission_grants
             (id, user_id, permission, context_type, context_id, granted_by_user_id, expires_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(id, input.userId, permission, contextType, contextId, adminDatabaseUserId(actor), expiresAt, now),
        prepareAuditLog(
          db,
          "admin",
          actor.id,
          "access_grant_created",
          "permission_grant",
          id,
          { userId: input.userId, permission, contextType, contextId, expiresAt },
          now,
        ),
      ]),
    );
  } catch (error) {
    if (isActiveAccessGrantConflict(error)) {
      throw new AppError(
        409,
        "ACCESS_GRANT_EXISTS",
        permissions.length > 1
          ? "This person already has one of these permissions for this target. Nothing was granted."
          : "An active matching access grant already exists",
      );
    }
    throw error;
  }

  return grants.map(({ id, permission }) =>
    accessGrantResponseSchema.parse({
      id,
      userId: input.userId,
      userEmail: user.email,
      permission,
      contextType,
      contextId,
      expiresAt,
      createdAt: now,
    }),
  );
}

export async function revokeAccessGrant(db: DatabaseLike, actor: AuthAdmin, grantId: string): Promise<void> {
  requirePermission(actor, "access:revoke");
  const grant = await first<{
    id: string;
    user_id: string;
    permission: string;
  }>(db, "SELECT id, user_id, permission FROM permission_grants WHERE id = ? AND revoked_at IS NULL", [grantId]);
  if (!grant) throw new AppError(404, "NOT_FOUND", "Grant not found");

  const now = nowIso();
  await commitAccessControlMutation(
    db,
    actor,
    [{ permission: "access:revoke" }],
    [
      db.prepare("UPDATE permission_grants SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").bind(now, grant.id),
      prepareAuditLogAfterOneChange(
        db,
        "admin",
        actor.id,
        "access_grant_revoked",
        "permission_grant",
        grant.id,
        { userId: grant.user_id, permission: grant.permission },
        now,
      ),
    ],
  );
}
