/**
 * Context-aware permission checking.
 *
 * Runtime authorization and delegated OAuth scopes share the canonical
 * permission vocabulary. Contextual grants come from D1; an OAuth/MCP token
 * can further restrict (never expand) those effective permissions.
 */
import { all } from "../db/queries";
import {
  isAuthorizationGuardFailure,
  prepareAuthorizationGuard,
  type AuthorizationEvidence,
} from "../db/authorization-guard";
import { guardDatabaseBatches } from "../db/guarded-database";
import { AppError } from "../errors";
import type { AuthAdmin, DatabaseLike, PermissionGrant, StatementLike } from "../types";
import { isUserBackedAuthAdmin } from "./admin-identity";
import { PERMISSION_DENIED_MESSAGE } from "../../../assets/shared/auth-errors";
import { PERMISSIONS, isPermission, type Permission } from "../../../assets/shared/schemas/permissions";

export { PERMISSIONS, isPermission, type Permission };

/**
 * Every permission string in the system (table, plus the
 * `organizations`/`sponsorships` additions pulled forward
 *, plus the `admin:read`/`admin:write` fallback pair for
 * admin routes not yet mapped to a named module — see consolidated migration 0035's
 * header comment).
 */
export interface PermissionContext {
  type: string;
  id: string;
}

export interface PermissionRequirement {
  permission: string;
  context?: PermissionContext;
}

interface GrantRow {
  permission: string;
  context_type: string | null;
  context_id: string | null;
}

/**
 * Resolves the full set of contextual permissions for a user from
 * `user_roles` (via `role_permissions`) and `permission_grants`, excluding
 * expired/revoked rows. Roles are bound only to immutable `user_id` values;
 * pre-provisioning creates a minimal user rather than attaching authorization
 * to a reusable email address (see consolidated migration 0035).
 *
 * Called on every authenticated admin request — see requireAdminFromRequest
 * in ./admin.ts. This is a deliberate deviation from "no DB query on
 * the request path" design: the existing session model already performs a
 * DB lookup on every request for revocation, so recomputing grants on that
 * same lookup gives real-time (not eventually-consistent, ≤15-minute)
 * revocation at no extra request-path cost.
 */
export async function computeGrantsForUser(db: DatabaseLike, userId: string): Promise<PermissionGrant[]> {
  const rows = await all<GrantRow>(
    db,
    `SELECT rp.permission AS permission, ur.context_type AS context_type, ur.context_id AS context_id
     FROM user_roles ur
     JOIN role_permissions rp ON rp.role_id = ur.role_id
     WHERE ur.user_id = ?
       AND ur.revoked_at IS NULL
       AND (ur.expires_at IS NULL OR ur.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     UNION ALL
     SELECT pg.permission AS permission, pg.context_type AS context_type, pg.context_id AS context_id
     FROM permission_grants pg
     WHERE pg.user_id = ?
       AND pg.revoked_at IS NULL
       AND (pg.expires_at IS NULL OR pg.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
    [userId, userId],
  );

  return rows.map((row) => ({
    permission: row.permission,
    contextType: row.context_type,
    contextId: row.context_id,
  }));
}

/**
 * True if `actor` holds `permission`, either globally or (when `context` is
 * given) scoped to that exact context. A global grant always satisfies a
 * contextual check; a contextual grant never satisfies a global-only check
 * (e.g. an event_organizer grant scoped to event A must not authorize a
 * request for events:write with no event context, and must not authorize a
 * request scoped to a different event B).
 */
export function hasPermission(actor: AuthAdmin, permission: string, context?: PermissionContext): boolean {
  if (actor.scopeRestricted && actor.scopes?.includes(permission) !== true) {
    return false;
  }
  if (actor.role === "admin") {
    return true;
  }

  const grants = actor.grants ?? [];
  return grants.some((grant) => {
    if (grant.permission !== permission) return false;
    if (grant.contextType === null && grant.contextId === null) return true;
    if (!context) return false;
    return grant.contextType === context.type && grant.contextId === context.id;
  });
}

export function requirePermission(actor: AuthAdmin, permission: string, context?: PermissionContext): void {
  if (actor.scopeRestricted && actor.scopes?.includes(permission) !== true) {
    throw new AppError(403, "SCOPE_REQUIRED", PERMISSION_DENIED_MESSAGE);
  }
  if (!hasPermission(actor, permission, context)) {
    const scope = context ? ` (context: ${context.type}:${context.id})` : "";
    throw new AppError(403, "PERMISSION_REQUIRED", `Missing required permission: ${permission}${scope}`);
  }
}

/** Require at least one permission without accidentally turning alternatives into an AND policy. */
export function requireAnyPermission(
  actor: AuthAdmin,
  permissions: readonly string[],
  context?: PermissionContext,
): void {
  if (permissions.some((permission) => hasPermission(actor, permission, context))) return;

  if (actor.scopeRestricted && !permissions.some((permission) => actor.scopes?.includes(permission) === true)) {
    throw new AppError(403, "SCOPE_REQUIRED", PERMISSION_DENIED_MESSAGE);
  }
  const scope = context ? ` (context: ${context.type}:${context.id})` : "";
  throw new AppError(
    403,
    "PERMISSION_REQUIRED",
    `Missing one of the required permissions: ${permissions.join(", ")}${scope}`,
  );
}

/**
 * Canonical live-D1 evidence for one or more permissions. Request preflight
 * uses `hasPermission`; protected mutation batches use this equivalent SQL so
 * revocation between authentication and commit fails atomically.
 */
export function permissionsAuthorizationEvidence(
  actor: AuthAdmin,
  requirements: readonly PermissionRequirement[],
): AuthorizationEvidence {
  const unique = [
    ...new Map(
      requirements.map((requirement) => [
        `${requirement.permission}\u0000${requirement.context?.type ?? ""}\u0000${requirement.context?.id ?? ""}`,
        requirement,
      ]),
    ).values(),
  ];
  if (unique.length === 0) return { sql: "SELECT 1", bindings: [] };
  if (unique.some(({ permission }) => actor.scopeRestricted && actor.scopes?.includes(permission) !== true)) {
    return { sql: "SELECT 1 WHERE 0", bindings: [] };
  }
  if (!isUserBackedAuthAdmin(actor)) {
    return unique.every(({ permission, context }) => hasPermission(actor, permission, context))
      ? { sql: "SELECT 1", bindings: [] }
      : { sql: "SELECT 1 WHERE 0", bindings: [] };
  }

  return {
    sql: `WITH required(permission, context_type, context_id) AS (
            SELECT json_extract(value, '$.permission'),
                   json_extract(value, '$.contextType'),
                   json_extract(value, '$.contextId')
              FROM json_each(?)
          )
          SELECT 1
            FROM users actor
           WHERE actor.id = ? AND actor.active = 1
             AND NOT EXISTS (
               SELECT 1
                 FROM required requirement
                WHERE NOT (
                  actor.role = 'admin'
                  OR EXISTS (
                    SELECT 1
                      FROM user_roles role
                      JOIN role_permissions role_permission ON role_permission.role_id = role.role_id
                     WHERE role.user_id = actor.id
                       AND role_permission.permission = requirement.permission
                       AND role.revoked_at IS NULL
                       AND (role.expires_at IS NULL OR role.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                       AND (
                         (role.context_type IS NULL AND role.context_id IS NULL)
                         OR (requirement.context_type IS NOT NULL
                             AND role.context_type = requirement.context_type
                             AND role.context_id = requirement.context_id)
                       )
                  )
                  OR EXISTS (
                    SELECT 1
                      FROM permission_grants grant_row
                     WHERE grant_row.user_id = actor.id
                       AND grant_row.permission = requirement.permission
                       AND grant_row.revoked_at IS NULL
                       AND (grant_row.expires_at IS NULL OR grant_row.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                       AND (
                         (grant_row.context_type IS NULL AND grant_row.context_id IS NULL)
                         OR (requirement.context_type IS NOT NULL
                             AND grant_row.context_type = requirement.context_type
                             AND grant_row.context_id = requirement.context_id)
                       )
                  )
                )
             )
           LIMIT 1`,
    bindings: [
      JSON.stringify(
        unique.map(({ permission, context }) => ({
          permission,
          contextType: context?.type ?? null,
          contextId: context?.id ?? null,
        })),
      ),
      actor.id,
    ],
  };
}

export function preparePermissionsAuthorizationGuard(
  db: DatabaseLike,
  actor: AuthAdmin,
  requirements: readonly PermissionRequirement[],
): StatementLike {
  return prepareAuthorizationGuard(db, permissionsAuthorizationEvidence(actor, requirements));
}

/**
 * Rechecks permission requirements before every batch issued by a mutation
 * service. The guard and the caller's statements commit or roll back as one D1
 * batch, while each domain retains its own public error code and message.
 */
export function guardPermissionDatabase(
  db: DatabaseLike,
  actor: AuthAdmin,
  requirements: readonly PermissionRequirement[],
  authorizationChangedError: () => AppError,
): DatabaseLike {
  return guardDatabaseBatches(db, async (statements) => {
    try {
      const [, ...results] = await db.batch([
        preparePermissionsAuthorizationGuard(db, actor, requirements),
        ...statements,
      ]);
      return results;
    } catch (error) {
      if (isAuthorizationGuardFailure(error)) throw authorizationChangedError();
      throw error;
    }
  });
}

/** Backward-compatible domain name for mutation callers; behavior is identical. */
export function guardPermissionMutationDatabase(
  db: DatabaseLike,
  actor: AuthAdmin,
  requirements: readonly PermissionRequirement[],
  authorizationChangedError: () => AppError,
): DatabaseLike {
  return guardPermissionDatabase(db, actor, requirements, authorizationChangedError);
}

interface EmailRow {
  email: string;
}

interface PermissionRecipientRow {
  id: string;
  email: string;
}

/**
 * Shared staff-recipient predicate. Authorization and notification fan-out
 * must use the same global-admin, role-permission, and direct-grant rules.
 * Inactive identities cannot authenticate as staff and are therefore not
 * intended notification recipients.
 */
export function staffPermissionPredicate(userAlias = "u"): string {
  return `(
    ${userAlias}.role = 'admin'
    OR EXISTS (
      SELECT 1
      FROM user_roles ur
      JOIN role_permissions rp ON rp.role_id = ur.role_id
      WHERE ur.user_id = ${userAlias}.id
        AND rp.permission = ?
        AND ur.revoked_at IS NULL
        AND (ur.expires_at IS NULL OR ur.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    )
    OR EXISTS (
      SELECT 1
      FROM permission_grants pg
      WHERE pg.user_id = ${userAlias}.id
        AND pg.permission = ?
        AND pg.revoked_at IS NULL
        AND (pg.expires_at IS NULL OR pg.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    )
  )`;
}

export async function findUserPermissionRecipients(
  db: DatabaseLike,
  permission: string,
): Promise<PermissionRecipientRow[]> {
  return all<PermissionRecipientRow>(
    db,
    `SELECT DISTINCT u.id, u.email
     FROM users u
     WHERE u.active = 1 AND ${staffPermissionPredicate("u")}`,
    [permission, permission],
  );
}

/**
 * Every user who can act on `permission` — role='admin' (always, matching
 * hasPermission's bypass) plus every user_roles/permission_grants holder,
 * global grants only (no context filtering — used for email fanout, e.g.
 * "Staff admins with organizations:content-review permission").
 */
export async function findUsersWithPermission(db: DatabaseLike, permission: string): Promise<string[]> {
  const rows = await all<EmailRow>(
    db,
    `SELECT DISTINCT email FROM users WHERE role = 'admin'
     UNION
     SELECT DISTINCT u.email FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN role_permissions rp ON rp.role_id = ur.role_id
     WHERE rp.permission = ?
       AND ur.revoked_at IS NULL
       AND (ur.expires_at IS NULL OR ur.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     UNION
     SELECT DISTINCT u.email FROM users u
       JOIN permission_grants pg ON pg.user_id = u.id
     WHERE pg.permission = ?
       AND pg.revoked_at IS NULL
       AND (pg.expires_at IS NULL OR pg.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
    [permission, permission],
  );
  return rows.map((row) => row.email);
}
