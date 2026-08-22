/**
 * Context-aware permission checking.
 *
 * Runtime authorization and delegated OAuth scopes share the canonical
 * permission vocabulary. Contextual grants come from D1; an OAuth/MCP token
 * can further restrict (never expand) those effective permissions.
 */
import { all } from "../db/queries";
import { normalizeEmail } from "../validation";
import { AppError } from "../errors";
import type { AuthAdmin, DatabaseLike, PermissionGrant } from "../types";
import { PERMISSION_DENIED_MESSAGE } from "../../../assets/shared/auth-errors";
import { PERMISSIONS, isPermission, type Permission } from "../../../assets/shared/schemas/permissions";

export { PERMISSIONS, isPermission, type Permission };

/**
 * Every permission string in the system (table, plus the
 * `organizations`/`sponsorships`/`sponsor-portal` additions pulled forward
 *, plus the `admin:read`/`admin:write` fallback pair for
 * admin routes not yet mapped to a named module — see consolidated migration 0035's
 * header comment).
 */
export interface PermissionContext {
  type: string;
  id: string;
}

interface GrantRow {
  permission: string;
  context_type: string | null;
  context_id: string | null;
}

/**
 * Resolves the full set of contextual permissions for a user from
 * `user_roles` (via `role_permissions`) and `permission_grants`, excluding
 * expired/revoked rows. Matches `user_roles` rows by `user_id` OR (when
 * `user_id IS NULL`) by normalized email, preserving the pre-provisioning
 * pattern `event_permissions` used (see consolidated migration 0035).
 *
 * Called on every authenticated admin request — see requireAdminFromRequest
 * in ./admin.ts. This is a deliberate deviation from "no DB query on
 * the request path" design: the existing session model already performs a
 * DB lookup on every request for revocation, so recomputing grants on that
 * same lookup gives real-time (not eventually-consistent, ≤15-minute)
 * revocation at no extra request-path cost.
 */
export async function computeGrantsForUser(
  db: DatabaseLike,
  userId: string,
  email: string,
): Promise<PermissionGrant[]> {
  const normalizedEmail = normalizeEmail(email);

  const rows = await all<GrantRow>(
    db,
    `SELECT rp.permission AS permission, ur.context_type AS context_type, ur.context_id AS context_id
     FROM user_roles ur
     JOIN role_permissions rp ON rp.role_id = ur.role_id
     WHERE (ur.user_id = ? OR (ur.user_id IS NULL AND ur.user_email = ?))
       AND ur.revoked_at IS NULL
       AND (ur.expires_at IS NULL OR ur.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     UNION ALL
     SELECT pg.permission AS permission, pg.context_type AS context_type, pg.context_id AS context_id
     FROM permission_grants pg
     WHERE pg.user_id = ?
       AND pg.revoked_at IS NULL
       AND (pg.expires_at IS NULL OR pg.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
    [userId, normalizedEmail, userId],
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

interface EmailRow {
  email: string;
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
