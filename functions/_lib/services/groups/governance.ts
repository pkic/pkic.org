import type {
  GroupLeadershipAssignment,
  GroupLeadershipAssignInput,
  GroupLeadershipListResponse,
} from "../../../../assets/shared/schemas/groups";
import { GROUP_LEADERSHIP_ROLE_IDS } from "../../../../assets/shared/schemas/groups";
import { hasPermission } from "../../auth/permissions";
import { all, first } from "../../db/queries";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike } from "../../types";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { prepareScopedAuditLog } from "../audit";
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

export async function canManageGroup(db: DatabaseLike, actor: AuthAdmin, groupId: string): Promise<boolean> {
  if (hasPermission(actor, "groups:write", { type: "group", id: groupId })) return true;
  if (actor.scopeRestricted && actor.scopes?.includes("groups:write") !== true) return false;

  const inherited = await first<{ authorized: number }>(
    db,
    `${EFFECTIVE_LINEAGE_CTE}
     SELECT 1 AS authorized
       FROM effective_lineage lineage
       JOIN user_roles ur
         ON ur.context_type = 'group' AND ur.context_id = lineage.id
        AND ur.user_id = ?
        AND ur.role_id IN ('role-group_lead', 'role-group_deputy_lead')
        AND ur.revoked_at IS NULL
        AND (ur.expires_at IS NULL OR ur.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       JOIN role_permissions rp ON rp.role_id = ur.role_id AND rp.permission = 'groups:write'
      LIMIT 1`,
    [groupId, actor.id],
  );
  return inherited !== null;
}

export async function requireGroupManagement(db: DatabaseLike, actor: AuthAdmin, groupId: string): Promise<void> {
  if (!(await canManageGroup(db, actor, groupId))) {
    throw new AppError(403, "GROUP_MANAGEMENT_REQUIRED", "Effective group management permission is required");
  }
}

/** True only for a global manager or leadership inherited from an ancestor. */
export async function canEnableLocalOnlyGovernance(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupId: string,
): Promise<boolean> {
  if (hasPermission(actor, "groups:write")) return true;
  if (actor.scopeRestricted && actor.scopes?.includes("groups:write") !== true) return false;
  const inherited = await first<{ authorized: number }>(
    db,
    `${EFFECTIVE_LINEAGE_CTE}
     SELECT 1 AS authorized
       FROM effective_lineage lineage
       JOIN user_roles ur
         ON ur.context_type = 'group' AND ur.context_id = lineage.id
        AND ur.user_id = ? AND lineage.depth > 0
        AND ur.role_id IN ('role-group_lead', 'role-group_deputy_lead')
        AND ur.revoked_at IS NULL
        AND (ur.expires_at IS NULL OR ur.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       JOIN role_permissions rp ON rp.role_id = ur.role_id AND rp.permission = 'groups:write'
      LIMIT 1`,
    [groupId, actor.id],
  );
  return inherited !== null;
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
  const at = nowIso();
  await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO user_roles
           (id, user_id, role_id, context_type, context_id, granted_by_user_id,
            single_holder_per_context, expires_at, created_at)
         SELECT ?, ?, ?, 'group', ?, ?, 0, ?, ?
          WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND active = 1)`,
      )
      .bind(uuid(), input.userId, roleId, groupId, actor.id, input.expiresAt ?? null, at, input.userId),
    prepareScopedAuditLog(
      db,
      { type: "group", id: groupId },
      "admin",
      actor.id,
      "group_leadership_assigned",
      "user_role",
      null,
      {
        userId: input.userId,
        roleId,
        expiresAt: input.expiresAt ?? null,
      },
    ),
  ]);
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
  await db.batch([
    db.prepare("UPDATE user_roles SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").bind(at, userRoleId),
    prepareScopedAuditLog(
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
}
