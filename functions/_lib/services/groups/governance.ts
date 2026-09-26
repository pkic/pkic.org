import { isUserBackedAuthAdmin } from "../../auth/admin-identity";
import { prepareAuthorizationGuard, type AuthorizationEvidence } from "../../db/authorization-guard";
import { buildD1JsonMembershipFilter } from "../../db/json-membership";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike, StatementLike } from "../../types";

export const EFFECTIVE_GROUP_LINEAGE_CTE = `WITH RECURSIVE effective_lineage(id, depth, continue_up) AS (
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

interface RequestedGroupsEvidence {
  sql: string;
  bindings: readonly unknown[];
  knownIds?: readonly string[];
}

/** Canonical group-management policy used for preflight and the D1 guard. */
function groupAuthorizationEvidence(
  actor: AuthAdmin,
  requestedGroups: RequestedGroupsEvidence,
  permission: string,
  mode: GroupManagementAuthorizationMode,
): AuthorizationEvidence {
  if (actor.scopeRestricted && actor.scopes?.includes(permission) !== true) {
    return deniedAuthorizationEvidence();
  }

  const hasGlobalSnapshot =
    actor.role === "admin" ||
    (actor.grants ?? []).some(
      (grant) => grant.permission === permission && grant.contextType === null && grant.contextId === null,
    );
  if (!isUserBackedAuthAdmin(actor)) {
    if (hasGlobalSnapshot) return trustedAuthorizationEvidence();
    if (mode === "effective") {
      const contextualIds = (actor.grants ?? [])
        .filter((grant) => grant.permission === permission && grant.contextType === "group" && grant.contextId)
        .map((grant) => grant.contextId as string);
      if (requestedGroups.knownIds?.some((groupId) => contextualIds.includes(groupId))) {
        return trustedAuthorizationEvidence();
      }
      if (contextualIds.length > 0) {
        /*
         * One JSON binding rather than a placeholder per id: the statement
         * already spends bindings on `requestedGroups`, and D1 allows a
         * hundred in total. A token carrying grants for a hundred groups is
         * unusual, not impossible, and the failure would be a denied
         * authorization that looks like a policy decision.
         */
        const granted = buildD1JsonMembershipFilter("id", contextualIds);
        return {
          sql: `WITH requested_groups(id) AS (${requestedGroups.sql})
                SELECT 1 FROM requested_groups
                 WHERE ${granted.sql}`,
          bindings: [...requestedGroups.bindings, ...granted.bindings],
        };
      }
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
              ${requestedGroups.sql}
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
                    AND role_permission.permission = ?
                    AND actor_role.revoked_at IS NULL
                    AND (actor_role.expires_at IS NULL OR actor_role.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                    AND (
                      actor_role.member_id IS NULL
                      OR (
                      actor_role.member_id = ?
                        AND actor_role.identity_id IS NOT NULL
                        AND actor_role.context_type = 'group'
                        AND EXISTS (
                          SELECT 1 FROM group_memberships active_capacity
                           WHERE active_capacity.group_id = actor_role.context_id
                             AND active_capacity.user_id = actor_role.user_id
                             AND active_capacity.identity_id = actor_role.identity_id
                             AND active_capacity.member_id = actor_role.member_id
                             AND active_capacity.left_at IS NULL
                        )
                      )
                    )
                    AND (
                      (actor_role.context_type IS NULL AND actor_role.context_id IS NULL)
                      OR ${contextualRolePredicate}
                    )
               )
               OR EXISTS (
                 SELECT 1
                   FROM permission_grants direct_grant
                  WHERE direct_grant.user_id = active_actor.id
                    AND direct_grant.permission = ?
                    AND direct_grant.revoked_at IS NULL
                    AND (direct_grant.expires_at IS NULL OR direct_grant.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                    AND (
                      (direct_grant.context_type IS NULL AND direct_grant.context_id IS NULL)
                      OR ${contextualGrantPredicate}
                    )
               )
             )
           LIMIT 1`,
    bindings: [...requestedGroups.bindings, actor.id, permission, actor.memberId ?? null, permission],
  };
}

function fixedRequestedGroups(groupIds: readonly string[]): RequestedGroupsEvidence {
  const targets = [...new Set(groupIds)];
  return {
    sql: "SELECT CAST(value AS TEXT) FROM json_each(?)",
    bindings: [JSON.stringify(targets)],
    knownIds: targets,
  };
}

export function groupPermissionAuthorizationEvidence(
  actor: AuthAdmin,
  groupIds: readonly string[],
  permission: string,
  mode: GroupManagementAuthorizationMode = "effective",
): AuthorizationEvidence {
  return groupAuthorizationEvidence(actor, fixedRequestedGroups(groupIds), permission, mode);
}

export function groupManagementAuthorizationEvidence(
  actor: AuthAdmin,
  groupIds: readonly string[],
  mode: GroupManagementAuthorizationMode = "effective",
): AuthorizationEvidence {
  return groupAuthorizationEvidence(actor, fixedRequestedGroups(groupIds), "groups:write", mode);
}

/**
 * Applies the same canonical authorization policy to a group row in a D1 list
 * query. The expression is internal SQL (normally `g.id`), never request data.
 */
export function groupManagementCandidateAuthorizationEvidence(
  actor: AuthAdmin,
  groupIdExpression = "g.id",
): AuthorizationEvidence {
  return groupAuthorizationEvidence(
    actor,
    { sql: `SELECT ${groupIdExpression}`, bindings: [] },
    "groups:write",
    "effective",
  );
}

export function prepareGroupManagementAuthorizationGuard(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIds: readonly string[],
  mode: GroupManagementAuthorizationMode = "effective",
): StatementLike {
  return prepareAuthorizationGuard(db, groupManagementAuthorizationEvidence(actor, groupIds, mode));
}

export function prepareEffectiveGroupPermissionAuthorizationGuard(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIds: readonly string[],
  permission: string,
): StatementLike {
  return prepareAuthorizationGuard(db, groupPermissionAuthorizationEvidence(actor, groupIds, permission));
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

export async function hasEffectiveGroupPermission(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIds: readonly string[],
  permission: string,
): Promise<boolean> {
  const targets = [...new Set(groupIds)];
  if (targets.length === 0) return false;
  const evidence = groupPermissionAuthorizationEvidence(actor, targets, permission);
  return (
    (await first<{ authorized: number }>(db, `SELECT 1 AS authorized WHERE EXISTS (${evidence.sql})`, [
      ...evidence.bindings,
    ])) !== null
  );
}

export async function requireEffectiveGroupPermission(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupId: string,
  permission: string,
): Promise<void> {
  if (!(await hasEffectiveGroupPermission(db, actor, [groupId], permission))) {
    throw new AppError(403, "GROUP_PERMISSION_REQUIRED", "Effective group permission is required");
  }
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

export async function canCreateGroup(db: DatabaseLike, actor: AuthAdmin): Promise<boolean> {
  return hasGroupManagementAuthorization(db, actor, [], "global");
}

/** True only for a global manager or leadership inherited from an ancestor. */
export async function canEnableLocalOnlyGovernance(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupId: string,
): Promise<boolean> {
  return hasGroupManagementAuthorization(db, actor, [groupId], "inherited_or_global");
}
