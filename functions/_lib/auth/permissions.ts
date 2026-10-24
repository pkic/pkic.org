import { activeOauthAuthorizationSql, oauthPermissionCeilingSql } from "./oauth/authorization-ceiling-query";
import { scannerCapabilities } from "../../../assets/shared/event-scanner-permissions";
/**
 * Context-aware permission checking.
 *
 * Runtime authorization and delegated OAuth scopes share the canonical
 * permission vocabulary. Contextual grants come from D1; an OAuth/MCP token
 * can further restrict (never expand) those effective permissions.
 */
import { all } from "../db/queries";
import {
  guardAuthorizedDatabase,
  prepareAuthorizationGuard,
  type AuthorizationEvidence,
} from "../db/authorization-guard";
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

export interface ContextGrantRow extends GrantRow {
  request_index: number;
  member_id: string | null;
}

/** One canonical live grant policy; callers only vary the prepared context input. */
function contextGrantSelection(requested: string, bindings: unknown[]) {
  return {
    sql: `WITH requested AS (${requested})
     SELECT requested.request_index,requested.member_id,rp.permission,ur.context_type,ur.context_id
     FROM requested JOIN user_roles ur ON ur.user_id=requested.user_id
     JOIN role_permissions rp ON rp.role_id=ur.role_id
     WHERE ur.revoked_at IS NULL
       AND (ur.expires_at IS NULL OR ur.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       AND (ur.member_id IS NULL OR (ur.member_id=requested.member_id AND ur.context_type='group'
         AND EXISTS(SELECT 1 FROM group_memberships gm WHERE gm.group_id=ur.context_id
           AND gm.user_id=ur.user_id AND gm.member_id=ur.member_id AND gm.left_at IS NULL)))
     UNION ALL
     SELECT requested.request_index,requested.member_id,pg.permission,pg.context_type,pg.context_id
     FROM requested JOIN permission_grants pg ON pg.user_id=requested.user_id
     WHERE pg.revoked_at IS NULL
       AND (pg.expires_at IS NULL OR pg.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
    bindings,
  };
}

function contextGrantStatement(db: DatabaseLike, requested: string, bindings: unknown[]) {
  const selection = contextGrantSelection(requested, bindings);
  return db.prepare(selection.sql).bind(...selection.bindings);
}
/** Reference the canonical live grants from another authorization predicate without issuing a read. */
export function userContextGrantSelection(userId: string, memberSelection?: AuthorizationEvidence) {
  return contextGrantSelection(
    `SELECT 0 AS request_index,? AS user_id,${memberSelection ? `(${memberSelection.sql})` : "NULL"} AS member_id`,
    [userId, ...(memberSelection?.bindings ?? [])],
  );
}
/** Prepare all assigned member-context candidates so choosing a live identity needs no second D1 call. */
export function prepareUserGrantCandidates(db: DatabaseLike, userIds: readonly string[]) {
  const users = JSON.stringify(userIds);
  return contextGrantStatement(
    db,
    `
    SELECT CAST(key AS INTEGER) AS request_index,value AS user_id,NULL AS member_id FROM json_each(?)
    UNION SELECT CAST(requested.key AS INTEGER),requested.value,role.member_id
      FROM json_each(?) requested JOIN user_roles role ON role.user_id=requested.value
      WHERE role.member_id IS NOT NULL`,
    [users, users],
  );
}

/** Decode only the chosen membership context, using the context-free candidate when no assignment names it. */
export function selectUserGrantCandidates(
  rows: ContextGrantRow[],
  requestIndex: number,
  memberId: string | null,
): PermissionGrant[] {
  const candidates = rows.filter((row) => row.request_index === requestIndex);
  const selected = memberId !== null && candidates.some((row) => row.member_id === memberId) ? memberId : null;
  return candidates
    .filter((row) => row.member_id === selected)
    .map((row) => ({
      permission: row.permission,
      contextType: row.context_type,
      contextId: row.context_id,
    }));
}

/** Setwise grant resolution uses one bound JSON input; no caller-controlled SQL expressions. */
export async function computeGrantsForContexts(
  db: DatabaseLike,
  contexts: readonly { userId: string; memberId: string | null }[],
): Promise<PermissionGrant[][]> {
  const { results: rows } = await contextGrantStatement(
    db,
    `
    SELECT CAST(key AS INTEGER) AS request_index,json_extract(value,'$.userId') AS user_id,
      json_extract(value,'$.memberId') AS member_id FROM json_each(?)`,
    [JSON.stringify(contexts)],
  ).all<ContextGrantRow>();
  const results = contexts.map(() => [] as PermissionGrant[]);
  for (const row of rows)
    results[row.request_index].push({
      permission: row.permission,
      contextType: row.context_type,
      contextId: row.context_id,
    });
  return results;
}

/**
 * Resolves the full set of contextual permissions for a user from
 * `user_roles` (via `role_permissions`) and `permission_grants`, excluding
 * expired/revoked rows. Roles are bound to immutable `user_id` values, and
 * capacity-bound group leadership additionally binds the represented
 * `member_id`;
 * pre-provisioning creates a minimal user rather than attaching authorization
 * to a reusable email address (see consolidated migration 0035).
 *
 * Called on every authenticated admin request — see requireAdminFromRequest
 * in ./admin.ts. This is a deliberate deviation from "no DB query on
 * the request path" design: the existing session model already performs a
 * DB lookup on every request for revocation. Grant resolution uses that
 * request's D1 session; reads accept the owner-approved replication lag,
 * while mutations recheck permission on primary in their atomic batch.
 */
export async function computeGrantsForUser(
  db: DatabaseLike,
  userId: string,
  activeMemberId: string | null = null,
): Promise<PermissionGrant[]> {
  const rows = await all<GrantRow>(
    db,
    `SELECT rp.permission AS permission, ur.context_type AS context_type, ur.context_id AS context_id
     FROM user_roles ur
     JOIN role_permissions rp ON rp.role_id = ur.role_id
     WHERE ur.user_id = ?
       AND ur.revoked_at IS NULL
       AND (ur.expires_at IS NULL OR ur.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       AND (
         ur.member_id IS NULL
         OR (
           ur.member_id = ?
           AND ur.context_type = 'group'
           AND EXISTS (
             SELECT 1 FROM group_memberships gm
              WHERE gm.group_id = ur.context_id
                AND gm.user_id = ur.user_id
                AND gm.member_id = ur.member_id
                AND gm.left_at IS NULL
           )
         )
       )
     UNION ALL
     SELECT pg.permission AS permission, pg.context_type AS context_type, pg.context_id AS context_id
     FROM permission_grants pg
     WHERE pg.user_id = ?
       AND pg.revoked_at IS NULL
       AND (pg.expires_at IS NULL OR pg.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
    [userId, activeMemberId, userId],
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
function scannerLegacyCompatible(permission: string): boolean {
  return (scannerCapabilities as readonly string[]).includes(permission);
}
function tokenAllowsPermission(actor: AuthAdmin, permission: string): boolean {
  return (
    !actor.scopeRestricted ||
    actor.scopes?.includes(permission) === true ||
    (scannerLegacyCompatible(permission) && actor.scopes?.includes("agenda:scan") === true)
  );
}
export function hasPermission(actor: AuthAdmin, permission: string, context?: PermissionContext): boolean {
  if (!tokenAllowsPermission(actor, permission)) {
    return false;
  }
  if (!isUserBackedAuthAdmin(actor) && actor.role === "admin") {
    return true;
  }

  return (actor.grants ?? []).some((grant) => permissionGrantAllows(grant, permission, context));
}

/** Canonical grant/context matching, shared by live checks and frozen OAuth ceilings. */
export function permissionGrantAllows(
  grant: PermissionGrant,
  permission: string,
  context?: PermissionContext,
): boolean {
  if (grant.permission !== permission && !(scannerLegacyCompatible(permission) && grant.permission === "agenda:scan"))
    return false;
  if (grant.contextType === null && grant.contextId === null) return true;
  return Boolean(context && grant.contextType === context.type && grant.contextId === context.id);
}

export function requirePermission(actor: AuthAdmin, permission: string, context?: PermissionContext): void {
  if (!tokenAllowsPermission(actor, permission)) {
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

  if (!permissions.some((permission) => tokenAllowsPermission(actor, permission))) {
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
 * uses `hasPermission`; protected reads and mutation batches use this equivalent
 * SQL so revocation between authentication and database access fails atomically.
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
  return buildPermissionsAuthorizationEvidence(actor, unique, {
    sql: `SELECT json_extract(value, '$.permission') AS permission,
                 json_extract(value, '$.contextType') AS context_type,
                 json_extract(value, '$.contextId') AS context_id
            FROM json_each(?)`,
    bindings: [
      JSON.stringify(
        unique.map(({ permission, context }) => ({
          permission,
          contextType: context?.type ?? null,
          contextId: context?.id ?? null,
        })),
      ),
    ],
  });
}

/** The resource ID expression is a trusted source column, never request input. */
export function permissionAuthorizationEvidenceForResource(
  actor: AuthAdmin,
  permission: string,
  context: { type: string; idSql: string },
  memberSelection?: AuthorizationEvidence,
): AuthorizationEvidence {
  if (!isUserBackedAuthAdmin(actor)) return permissionsAuthorizationEvidence(actor, [{ permission }]);
  return buildPermissionsAuthorizationEvidence(
    actor,
    [{ permission }],
    {
      sql: `SELECT ? AS permission, ? AS context_type, ${context.idSql} AS context_id`,
      bindings: [permission, context.type],
    },
    "all",
    memberSelection,
  );
}

/** Dynamic requirements remain internal SQL; the canonical matcher enforces token, live grants, and OAuth ceilings. */
export function anyPermissionAuthorizationEvidenceFromSelection(
  actor: AuthAdmin,
  permissions: readonly string[],
  required: AuthorizationEvidence,
  memberSelection?: AuthorizationEvidence,
) {
  const allowed = [...new Set(permissions)].filter((permission) => tokenAllowsPermission(actor, permission));
  if (!allowed.length) return { sql: "SELECT 1 WHERE 0", bindings: [] };
  return buildPermissionsAuthorizationEvidence(
    actor,
    allowed.map((permission) => ({ permission })),
    required,
    "any",
    memberSelection,
  );
}
/** Live alternatives for a trusted resource column, with delegated scopes still limiting each alternative. */
export function anyPermissionAuthorizationEvidenceForResource(
  actor: AuthAdmin,
  permissions: readonly string[],
  context: { type: string; idSql: string },
): AuthorizationEvidence {
  const allowed = [...new Set(permissions)].filter((permission) => tokenAllowsPermission(actor, permission));
  if (!allowed.length) return { sql: "SELECT 1 WHERE 0", bindings: [] };
  if (!isUserBackedAuthAdmin(actor))
    return allowed.some((permission) => hasPermission(actor, permission))
      ? { sql: "SELECT 1", bindings: [] }
      : { sql: "SELECT 1 WHERE 0", bindings: [] };
  return buildPermissionsAuthorizationEvidence(
    actor,
    allowed.map((permission) => ({ permission })),
    {
      sql: `SELECT value AS permission, ? AS context_type, ${context.idSql} AS context_id FROM json_each(?)`,
      bindings: [context.type, JSON.stringify(allowed)],
    },
    "any",
  );
}

function buildPermissionsAuthorizationEvidence(
  actor: AuthAdmin,
  unique: readonly PermissionRequirement[],
  required: AuthorizationEvidence,
  match: "all" | "any" = "all",
  memberSelection?: AuthorizationEvidence,
): AuthorizationEvidence {
  if (unique.length === 0) return { sql: "SELECT 1", bindings: [] };
  if (unique.some(({ permission }) => !tokenAllowsPermission(actor, permission))) {
    return { sql: "SELECT 1 WHERE 0", bindings: [] };
  }
  if (!isUserBackedAuthAdmin(actor)) {
    return unique.every(({ permission, context }) => hasPermission(actor, permission, context))
      ? { sql: "SELECT 1", bindings: [] }
      : { sql: "SELECT 1 WHERE 0", bindings: [] };
  }

  const delegatedCeiling = actor.oauthAuthorizationId
    ? `EXISTS(SELECT 1 FROM oauth_authorizations authorization
    WHERE authorization.id=? AND authorization.user_id=actor.id AND authorization.session_id=?
      AND ${activeOauthAuthorizationSql("authorization")} AND ${oauthPermissionCeilingSql("authorization", "requirement")}) AND (`
    : "";
  return {
    sql: `WITH required(permission, context_type, context_id, scanner_legacy_compatible) AS (
            SELECT permission, context_type, context_id,
                   permission IN (SELECT value FROM json_each(?))
              FROM (${required.sql})
          )${memberSelection ? `, selected_actor_member(member_id) AS MATERIALIZED(${memberSelection.sql})` : ""}
          SELECT 1
            FROM users actor
           WHERE actor.id = ? AND actor.active = 1
             ${actor.sessionId ? "AND EXISTS(SELECT 1 FROM sessions active_session WHERE active_session.id=? AND active_session.user_id=actor.id AND active_session.revoked_at IS NULL AND active_session.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))" : ""}
             AND ${match === "any" ? "EXISTS" : "NOT EXISTS"} (
               SELECT 1
                 FROM required requirement
                WHERE ${match === "any" ? "" : "NOT"} (
                  ${delegatedCeiling}
                  EXISTS (
                    SELECT 1
                      FROM user_roles role
                      JOIN role_permissions role_permission ON role_permission.role_id = role.role_id
                     WHERE role.user_id = actor.id
                       AND (role_permission.permission = requirement.permission OR (requirement.scanner_legacy_compatible=1 AND role_permission.permission='agenda:scan'))
                       AND role.revoked_at IS NULL
                       AND (role.expires_at IS NULL OR role.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                       AND (
                         role.member_id IS NULL
                         OR (
                           role.member_id = ${memberSelection ? "(SELECT member_id FROM selected_actor_member)" : "?"}
                           AND role.context_type = 'group'
                           AND EXISTS (
                             SELECT 1 FROM group_memberships membership
                              WHERE membership.group_id = role.context_id
                                AND membership.user_id = role.user_id
                                AND membership.member_id = role.member_id
                                AND membership.left_at IS NULL
                           )
                         )
                       )
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
                       AND (grant_row.permission = requirement.permission OR (requirement.scanner_legacy_compatible=1 AND grant_row.permission='agenda:scan'))
                       AND grant_row.revoked_at IS NULL
                       AND (grant_row.expires_at IS NULL OR grant_row.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                       AND (
                         (grant_row.context_type IS NULL AND grant_row.context_id IS NULL)
                         OR (requirement.context_type IS NOT NULL
                             AND grant_row.context_type = requirement.context_type
                             AND grant_row.context_id = requirement.context_id)
                       )
                  )
                  ${actor.oauthAuthorizationId ? ")" : ""}
                )
             )
           LIMIT 1`,
    bindings: [
      JSON.stringify(scannerCapabilities),
      ...required.bindings,
      ...(memberSelection?.bindings ?? []),
      actor.id,
      ...(actor.sessionId ? [actor.sessionId] : []),
      ...(actor.oauthAuthorizationId ? [actor.oauthAuthorizationId, actor.sessionId ?? null] : []),
      ...(memberSelection ? [] : [actor.memberId ?? null]),
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

/** Rechecks read authorization on the serving replica and mutation authorization atomically on primary. */
export function guardPermissionDatabase(
  db: DatabaseLike,
  actor: AuthAdmin,
  requirements: readonly PermissionRequirement[],
  authorizationChangedError: () => AppError,
): DatabaseLike {
  return guardAuthorizedDatabase(db, permissionsAuthorizationEvidence(actor, requirements), authorizationChangedError);
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
export function staffPermissionPredicate(userAlias = "u", globalOnly = false): string {
  return `(
    EXISTS (
      SELECT 1
      FROM user_roles ur
      JOIN role_permissions rp ON rp.role_id = ur.role_id
      WHERE ur.user_id = ${userAlias}.id
        AND rp.permission = ?
        ${globalOnly ? "AND ur.context_type IS NULL AND ur.context_id IS NULL AND ur.member_id IS NULL" : ""}
        AND ur.revoked_at IS NULL
        AND (ur.expires_at IS NULL OR ur.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    )
    OR EXISTS (
      SELECT 1
      FROM permission_grants pg
      WHERE pg.user_id = ${userAlias}.id
        AND pg.permission = ?
        ${globalOnly ? "AND pg.context_type IS NULL AND pg.context_id IS NULL" : ""}
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
 * Every user who holds `permission` through user_roles or permission_grants,
 * global grants only (no context filtering — used for email fanout, e.g.
 * "Staff admins with organizations:content-review permission").
 */
export async function findUsersWithPermission(db: DatabaseLike, permission: string): Promise<string[]> {
  const rows = await all<EmailRow>(
    db,
    `SELECT DISTINCT u.email FROM users u
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
