import type {
  GroupLeadershipAssignment,
  GroupLeadershipAssignInput,
  GroupLeadershipListResponse,
} from "../../../../assets/shared/schemas/groups";
import { GROUP_LEADERSHIP_ROLE_IDS } from "../../../../assets/shared/schemas/groups";
import { adminDatabaseUserId, isUserBackedAuthAdmin } from "../../auth/admin-identity";
import {
  isAuthorizationGuardFailure,
  prepareAuthorizationGuard,
  type AuthorizationEvidence,
} from "../../db/authorization-guard";
import { all, first } from "../../db/queries";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike, StatementLike } from "../../types";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { isAuditChangeGuardFailure, prepareScopedAuditLogAfterOneChange } from "../audit";
import { getGroup } from "./read-model";

const EFFECTIVE_LINEAGE_CTE = `WITH RECURSIVE effective_lineage(id, depth, continue_up) AS (
  SELECT g.id, 0, CASE WHEN g.governance_inheritance_mode = 'inherited' THEN 1 ELSE 0 END
  FROM groups g
  WHERE g.id = ?
  UNION ALL
  SELECT parent.id, lineage.depth + 1,
         CASE WHEN parent.governance_inheritance_mode = 'inherited' THEN 1 ELSE 0 END
  FROM effective_lineage lineage
  JOIN groups child ON child.id = lineage.id
  JOIN groups parent ON parent.id = child.parent_group_id
  WHERE lineage.continue_up = 1
)`;

export type GroupManagementAuthorizationMode = "effective" | "inherited_or_global" | "global";

function deniedAuthorizationEvidence(): AuthorizationEvidence {
  return { sql: "SELECT 1 WHERE 0", bindings: [] };
}

function trustedAuthorizationEvidence(): AuthorizationEvidence {
  return { sql: "SELECT 1", bindings: [] };
}

/**
 * Canonical group-management policy as executable SQL evidence. The same
 * evidence is used for request preflight and for a transient guard inside the
 * protected D1 batch, avoiding a second trigger-owned policy model.
 */
export function groupManagementAuthorizationEvidence(
  actor: AuthAdmin,
  groupIds: readonly string[],
  mode: GroupManagementAuthorizationMode = "effective",
): AuthorizationEvidence {
  const targets = [...new Set(groupIds)];
  if (actor.scopeRestricted && actor.scopes?.includes("groups:write") !== true) {
    return deniedAuthorizationEvidence();
  }

  const hasGlobalSnapshot =
    actor.role === "admin" ||
    (actor.grants ?? []).some(
      (grant) => grant.permission === "groups:write" && grant.contextType === null && grant.contextId === null,
    );
  if (!isUserBackedAuthAdmin(actor)) {
    if (hasGlobalSnapshot) return trustedAuthorizationEvidence();
    if (
      mode === "effective" &&
      targets.some((groupId) =>
        (actor.grants ?? []).some(
          (grant) =>
            grant.permission === "groups:write" && grant.contextType === "group" && grant.contextId === groupId,
        ),
      )
    ) {
      return trustedAuthorizationEvidence();
    }
    return deniedAuthorizationEvidence();
  }

  const contextualRolePredicate =
    mode === "effective"
      ? `(actor_role.context_type = 'group' AND EXISTS (
           SELECT 1 FROM effective_lineage lineage
            WHERE lineage.id = actor_role.context_id
              AND (lineage.depth = 0 OR actor_role.role_id IN ('role-group_lead', 'role-group_deputy_lead'))
         ))`
      : mode === "inherited_or_global"
        ? `(actor_role.context_type = 'group'
           AND actor_role.role_id IN ('role-group_lead', 'role-group_deputy_lead')
           AND EXISTS (
             SELECT 1 FROM effective_lineage lineage
              WHERE lineage.id = actor_role.context_id AND lineage.depth > 0
           ))`
        : "0";
  const contextualGrantPredicate =
    mode === "effective"
      ? `(direct_grant.context_type = 'group' AND EXISTS (
           SELECT 1 FROM requested_groups target WHERE target.id = direct_grant.context_id
         ))`
      : "0";

  return {
    sql: `WITH RECURSIVE
            requested_groups(id) AS (
              SELECT CAST(value AS TEXT) FROM json_each(?)
            ),
            effective_lineage(target_id, id, depth, continue_up) AS (
              SELECT target.id, target_group.id, 0,
                     CASE WHEN target_group.governance_inheritance_mode = 'inherited' THEN 1 ELSE 0 END
                FROM requested_groups target
                JOIN groups target_group ON target_group.id = target.id
              UNION ALL
              SELECT lineage.target_id, parent.id, lineage.depth + 1,
                     CASE WHEN parent.governance_inheritance_mode = 'inherited' THEN 1 ELSE 0 END
                FROM effective_lineage lineage
                JOIN groups child ON child.id = lineage.id
                JOIN groups parent ON parent.id = child.parent_group_id
               WHERE lineage.continue_up = 1
            )
          SELECT 1
            FROM users active_actor
           WHERE active_actor.id = ? AND active_actor.active = 1
             AND (
               active_actor.role = 'admin'
               OR EXISTS (
                 SELECT 1
                   FROM user_roles actor_role
                   JOIN role_permissions role_permission ON role_permission.role_id = actor_role.role_id
                  WHERE actor_role.user_id = active_actor.id
                    AND role_permission.permission = 'groups:write'
                    AND actor_role.revoked_at IS NULL
                    AND (actor_role.expires_at IS NULL OR actor_role.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                    AND (
                      (actor_role.context_type IS NULL AND actor_role.context_id IS NULL)
                      OR ${contextualRolePredicate}
                    )
               )
               OR EXISTS (
                 SELECT 1
                   FROM permission_grants direct_grant
                  WHERE direct_grant.user_id = active_actor.id
                    AND direct_grant.permission = 'groups:write'
                    AND direct_grant.revoked_at IS NULL
                    AND (direct_grant.expires_at IS NULL OR direct_grant.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                    AND (
                      (direct_grant.context_type IS NULL AND direct_grant.context_id IS NULL)
                      OR ${contextualGrantPredicate}
                    )
               )
             )
           LIMIT 1`,
    bindings: [JSON.stringify(targets), actor.id],
  };
}

export function prepareGroupManagementAuthorizationGuard(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIds: readonly string[],
  mode: GroupManagementAuthorizationMode = "effective",
): StatementLike {
  return prepareAuthorizationGuard(db, groupManagementAuthorizationEvidence(actor, groupIds, mode));
}

async function hasGroupManagementAuthorization(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIds: readonly string[],
  mode: GroupManagementAuthorizationMode,
): Promise<boolean> {
  const evidence = groupManagementAuthorizationEvidence(actor, groupIds, mode);
  return (
    (await first<{ authorized: number }>(db, `SELECT 1 AS authorized WHERE EXISTS (${evidence.sql})`, [
      ...evidence.bindings,
    ])) !== null
  );
}

interface LeadershipRow {
  user_role_id: string;
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  role_id: GroupLeadershipAssignment["roleId"];
  source_group_id: string;
  source_group_slug: string;
  source_group_name: string;
  source_group_type_key: string;
  source_group_type_singular_label: string;
  source_group_type_plural_label: string;
  depth: number;
  expires_at: string | null;
  created_at: string;
}

function mapLeadership(row: LeadershipRow): GroupLeadershipAssignment {
  return {
    userRoleId: row.user_role_id,
    userId: row.user_id,
    userName: [row.first_name, row.last_name].filter(Boolean).join(" ") || row.email,
    email: row.email,
    roleId: row.role_id,
    sourceGroup: {
      id: row.source_group_id,
      slug: row.source_group_slug,
      name: row.source_group_name,
      type: {
        key: row.source_group_type_key,
        singularLabel: row.source_group_type_singular_label,
        pluralLabel: row.source_group_type_plural_label,
      },
    },
    inherited: row.depth > 0,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

export async function listEffectiveGroupLeadership(
  db: DatabaseLike,
  groupIdOrSlug: string,
): Promise<GroupLeadershipListResponse> {
  const group = await getGroup(db, groupIdOrSlug);
  if (!group) throw new AppError(404, "GROUP_NOT_FOUND", "Group not found");
  const rows = await all<LeadershipRow>(
    db,
    `${EFFECTIVE_LINEAGE_CTE}
     SELECT ur.id AS user_role_id, ur.user_id, u.first_name, u.last_name, u.email,
            ur.role_id, source_group.id AS source_group_id,
            source_group.slug AS source_group_slug, source_group.name AS source_group_name,
            source_group.type_key AS source_group_type_key,
            gt.singular_label AS source_group_type_singular_label,
            gt.plural_label AS source_group_type_plural_label,
            lineage.depth, ur.expires_at, ur.created_at
       FROM effective_lineage lineage
       JOIN groups source_group ON source_group.id = lineage.id
       JOIN group_types gt ON gt.key = source_group.type_key
       JOIN user_roles ur
         ON ur.context_type = 'group' AND ur.context_id = lineage.id
        AND ur.role_id IN ('role-group_lead', 'role-group_deputy_lead')
        AND ur.revoked_at IS NULL
        AND (ur.expires_at IS NULL OR ur.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       JOIN users u ON u.id = ur.user_id AND u.active = 1
      ORDER BY lineage.depth, CASE ur.role_id WHEN 'role-group_lead' THEN 0 ELSE 1 END,
               LOWER(COALESCE(u.last_name, '')), LOWER(COALESCE(u.first_name, '')), u.id`,
    [group.id],
  );
  return {
    group: { id: group.id, slug: group.slug, name: group.name, type: group.type },
    governanceInheritanceMode: group.governanceInheritanceMode,
    assignments: rows.map(mapLeadership),
  };
}

export async function canManageAnyGroup(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIds: readonly string[],
): Promise<boolean> {
  const targets = [...new Set(groupIds)];
  if (targets.length === 0) return false;
  return hasGroupManagementAuthorization(db, actor, targets, "effective");
}

export async function canManageGroup(db: DatabaseLike, actor: AuthAdmin, groupId: string): Promise<boolean> {
  return canManageAnyGroup(db, actor, [groupId]);
}

export async function requireGroupManagement(db: DatabaseLike, actor: AuthAdmin, groupId: string): Promise<void> {
  if (!(await canManageGroup(db, actor, groupId))) {
    throw new AppError(403, "GROUP_MANAGEMENT_REQUIRED", "Effective group management permission is required");
  }
}

export async function requireGlobalGroupManagement(db: DatabaseLike, actor: AuthAdmin): Promise<void> {
  if (!(await hasGroupManagementAuthorization(db, actor, [], "global"))) {
    throw new AppError(403, "GROUP_CREATE_REQUIRED", "Global group management permission is required");
  }
}

/** True only for a global manager or leadership inherited from an ancestor. */
export async function canEnableLocalOnlyGovernance(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupId: string,
): Promise<boolean> {
  return hasGroupManagementAuthorization(db, actor, [groupId], "inherited_or_global");
}

export async function assignLocalGroupLeadership(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupId: string,
  input: GroupLeadershipAssignInput,
): Promise<void> {
  await requireGroupManagement(db, actor, groupId);
  const roleId = GROUP_LEADERSHIP_ROLE_IDS.find((candidate) => candidate === input.roleId);
  if (!roleId) throw new AppError(400, "GROUP_ROLE_INVALID", "Unsupported group leadership role");
  if (!(await first(db, "SELECT id FROM users WHERE id = ? AND active = 1", [input.userId]))) {
    throw new AppError(400, "GROUP_LEADER_INVALID", "The selected group leader is not an active user");
  }
  if (
    await first(
      db,
      `SELECT id FROM user_roles
        WHERE user_id = ? AND role_id = ? AND context_type = 'group' AND context_id = ?
          AND revoked_at IS NULL`,
      [input.userId, roleId, groupId],
    )
  ) {
    throw new AppError(409, "GROUP_LEADERSHIP_EXISTS", "This active group leadership assignment already exists");
  }
  const at = nowIso();
  const userRoleId = uuid();
  try {
    await db.batch([
      prepareGroupManagementAuthorizationGuard(db, actor, [groupId]),
      db
        .prepare(
          `INSERT INTO user_roles
             (id, user_id, role_id, context_type, context_id, granted_by_user_id,
              single_holder_per_context, expires_at, created_at)
           VALUES (?, ?, ?, 'group', ?, ?, 0, ?, ?)`,
        )
        .bind(userRoleId, input.userId, roleId, groupId, adminDatabaseUserId(actor), input.expiresAt ?? null, at),
      prepareScopedAuditLogAfterOneChange(
        db,
        { type: "group", id: groupId },
        "admin",
        actor.id,
        "group_leadership_assigned",
        "user_role",
        userRoleId,
        {
          userId: input.userId,
          roleId,
          expiresAt: input.expiresAt ?? null,
        },
      ),
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(409, "GROUP_MANAGEMENT_CHANGED", "Group management permission changed before commit");
    }
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("uq_user_roles_active_user_role_context")) {
      throw new AppError(409, "GROUP_LEADERSHIP_EXISTS", "This active group leadership assignment already exists");
    }
    throw error;
  }
}

export async function revokeLocalGroupLeadership(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupId: string,
  userRoleId: string,
): Promise<void> {
  await requireGroupManagement(db, actor, groupId);
  const assignment = await first<{ governance_inheritance_mode: string }>(
    db,
    `SELECT g.governance_inheritance_mode
       FROM user_roles ur JOIN groups g ON g.id = ur.context_id
      WHERE ur.id = ? AND ur.context_type = 'group' AND ur.context_id = ?
        AND ur.role_id IN ('role-group_lead', 'role-group_deputy_lead')
        AND ur.revoked_at IS NULL`,
    [userRoleId, groupId],
  );
  if (!assignment)
    throw new AppError(404, "GROUP_LEADERSHIP_NOT_FOUND", "Active local leadership assignment not found");
  if (assignment.governance_inheritance_mode === "local_only") {
    const alternative = await first<{ id: string }>(
      db,
      `SELECT id FROM user_roles
        WHERE context_type = 'group' AND context_id = ?
          AND role_id IN ('role-group_lead', 'role-group_deputy_lead')
          AND revoked_at IS NULL AND id <> ?
          AND (expires_at IS NULL OR expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        LIMIT 1`,
      [groupId, userRoleId],
    );
    if (!alternative) {
      throw new AppError(409, "GROUP_LOCAL_LEADERSHIP_REQUIRED", "Local-only governance requires a local leader");
    }
  }
  const at = nowIso();
  try {
    await db.batch([
      prepareGroupManagementAuthorizationGuard(db, actor, [groupId]),
      db
        .prepare(
          `UPDATE user_roles
              SET revoked_at = ?
            WHERE id = ? AND context_type = 'group' AND context_id = ?
              AND role_id IN ('role-group_lead', 'role-group_deputy_lead')
              AND revoked_at IS NULL
              AND (
                EXISTS (
                  SELECT 1 FROM groups g
                   WHERE g.id = ? AND g.governance_inheritance_mode <> 'local_only'
                )
                OR EXISTS (
                  SELECT 1 FROM user_roles alternative
                   WHERE alternative.context_type = 'group' AND alternative.context_id = ?
                     AND alternative.role_id IN ('role-group_lead', 'role-group_deputy_lead')
                     AND alternative.revoked_at IS NULL AND alternative.id <> ?
                     AND (alternative.expires_at IS NULL OR alternative.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                )
              )`,
        )
        .bind(at, userRoleId, groupId, groupId, groupId, userRoleId),
      prepareScopedAuditLogAfterOneChange(
        db,
        { type: "group", id: groupId },
        "admin",
        actor.id,
        "group_leadership_revoked",
        "user_role",
        userRoleId,
        {},
      ),
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(409, "GROUP_MANAGEMENT_CHANGED", "Group management permission changed before commit");
    }
    if (isAuditChangeGuardFailure(error)) {
      throw new AppError(409, "GROUP_LEADERSHIP_CHANGED", "Group leadership changed before commit");
    }
    throw error;
  }
}
