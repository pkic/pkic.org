/**
 * Group leadership: capacity-bound lead and deputy-lead assignments with the
 * title and tenure each was made with.
 *
 * Authority is the `user_roles` row and stays exactly what the rest of the
 * authorization model reads: active while `revoked_at` is null and
 * `expires_at` has not passed. The title and `starts_at` are display facts on
 * the same row, so a Board chair's public tenure, the portal's leadership tab,
 * and the permission check never disagree about who holds what.
 */
import type {
  GroupLeadershipAssignment,
  GroupLeadershipAssignInput,
  GroupLeadershipListResponse,
  GroupLeadershipRoleId,
  GroupLeadershipUpdateInput,
} from "../../../../assets/shared/schemas/groups";
import { GROUP_LEADERSHIP_ROLE_IDS, defaultGroupLeadershipTitle } from "../../../../assets/shared/schemas/groups";
import { adminDatabaseUserId } from "../../auth/admin-identity";
import { isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { all, first } from "../../db/queries";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike } from "../../types";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { isAuditChangeGuardFailure, prepareScopedAuditLogAfterOneChange } from "../audit";
import { publicUserHeadshotPath } from "../user-headshot";
import {
  EFFECTIVE_GROUP_LINEAGE_CTE,
  prepareGroupManagementAuthorizationGuard,
  requireGroupManagement,
} from "./governance";
import { getGroup } from "./read-model";

const LEADERSHIP_ROLE_PREDICATE_SQL = `ur.role_id IN ('role-group_lead', 'role-group_deputy_lead')`;
const ACTIVE_LEADERSHIP_PREDICATE_SQL = `ur.revoked_at IS NULL
  AND (ur.expires_at IS NULL OR ur.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

/**
 * The displayed title and term of one assignment. A row written before titles
 * existed falls back to its source group type's title for the role; the term
 * start falls back to the grant instant.
 */
export const LEADERSHIP_TERM_SELECT_SQL = `
  COALESCE(ur.title, CASE ur.role_id WHEN 'role-group_lead' THEN gt.lead_title ELSE gt.deputy_lead_title END) AS title,
  COALESCE(ur.starts_at, ur.created_at) AS starts_at,
  CASE WHEN ur.revoked_at IS NOT NULL THEN ur.revoked_at ELSE ur.expires_at END AS ends_at,
  CASE WHEN ${ACTIVE_LEADERSHIP_PREDICATE_SQL} THEN 1 ELSE 0 END AS active`;

interface LeadershipRow {
  user_role_id: string;
  user_id: string;
  identity_id: string;
  member_id: string;
  member_type: "individual" | "organization";
  organization_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string;
  job_title: string | null;
  headshot_r2_key: string | null;
  role_id: GroupLeadershipRoleId;
  title: string;
  source_group_id: string;
  source_group_slug: string;
  source_group_name: string;
  source_group_type_key: string;
  source_group_type_singular_label: string;
  source_group_type_plural_label: string;
  depth: number;
  active: number;
  starts_at: string;
  ends_at: string | null;
  created_at: string;
}

function mapLeadership(row: LeadershipRow): GroupLeadershipAssignment {
  return {
    userRoleId: row.user_role_id,
    userId: row.user_id,
    identityId: row.identity_id,
    memberId: row.member_id,
    memberType: row.member_type,
    organizationName: row.organization_name,
    userName: [row.first_name, row.last_name].filter(Boolean).join(" ") || row.email,
    email: row.email,
    jobTitle: row.job_title,
    headshotUrl: publicUserHeadshotPath(row.headshot_r2_key),
    roleId: row.role_id,
    title: row.title,
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
    active: row.active === 1,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    createdAt: row.created_at,
  };
}

const LEADERSHIP_ROW_SELECT_SQL = `
  SELECT ur.id AS user_role_id, ur.user_id, ur.identity_id, ur.member_id,
         CASE WHEN member.organization_id IS NULL THEN 'individual' ELSE 'organization' END AS member_type,
         organization.name AS organization_name,
         u.first_name, u.last_name,
         COALESCE(selected_email.email, u.email) AS email,
         identity.job_title, u.headshot_r2_key,
         ur.role_id, ${LEADERSHIP_TERM_SELECT_SQL},
         source_group.id AS source_group_id,
         source_group.slug AS source_group_slug, source_group.name AS source_group_name,
         source_group.type_key AS source_group_type_key,
         gt.singular_label AS source_group_type_singular_label,
         gt.plural_label AS source_group_type_plural_label,
         lineage.depth, ur.created_at`;

const LEADERSHIP_ORDER_SQL = `LOWER(COALESCE(u.last_name, '')), LOWER(COALESCE(u.first_name, '')), u.id`;

/** Effective leadership now: local assignments and those inherited through ancestors. */
async function listCurrentLeadership(db: DatabaseLike, groupId: string): Promise<GroupLeadershipAssignment[]> {
  const rows = await all<LeadershipRow>(
    db,
    `${EFFECTIVE_GROUP_LINEAGE_CTE}
     ${LEADERSHIP_ROW_SELECT_SQL}
       FROM effective_lineage lineage
       JOIN groups source_group ON source_group.id = lineage.id
       JOIN group_types gt ON gt.key = source_group.type_key
       JOIN user_roles ur
         ON ur.context_type = 'group' AND ur.context_id = lineage.id
        AND ${LEADERSHIP_ROLE_PREDICATE_SQL}
        AND ${ACTIVE_LEADERSHIP_PREDICATE_SQL}
       JOIN users u ON u.id = ur.user_id AND u.active = 1
       JOIN group_memberships membership
         ON membership.group_id = source_group.id
        AND membership.user_id = ur.user_id
        AND membership.identity_id = ur.identity_id
        AND membership.member_id = ur.member_id
        AND membership.left_at IS NULL
       JOIN members member ON member.id = membership.member_id AND member.status = 'active'
       LEFT JOIN organizations organization ON organization.id = member.organization_id
       JOIN identities identity
         ON identity.id = ur.identity_id
        AND identity.user_id = ur.user_id
        AND identity.started_at IS NOT NULL
        AND identity.ended_at IS NULL
        AND identity.blocked_at IS NULL
       JOIN identity_member_capacities capacity
         ON capacity.identity_id = identity.id
        AND capacity.member_id = member.id
       LEFT JOIN user_emails selected_email ON selected_email.id = identity.email_id
      ORDER BY lineage.depth, CASE ur.role_id WHEN 'role-group_lead' THEN 0 ELSE 1 END, ${LEADERSHIP_ORDER_SQL}`,
    [groupId],
  );
  return rows.map(mapLeadership);
}

/**
 * Closed local terms, most recently ended first. History joins the exact
 * identity and Member the assignment was held through rather than a live
 * membership, so a former chair whose representation has since ended keeps
 * their attribution.
 */
async function listPastLeadership(db: DatabaseLike, groupId: string): Promise<GroupLeadershipAssignment[]> {
  const rows = await all<LeadershipRow>(
    db,
    `${LEADERSHIP_ROW_SELECT_SQL}
       FROM groups source_group
       JOIN group_types gt ON gt.key = source_group.type_key
       JOIN (SELECT 0 AS depth) lineage
       JOIN user_roles ur
         ON ur.context_type = 'group' AND ur.context_id = source_group.id
        AND ${LEADERSHIP_ROLE_PREDICATE_SQL}
        AND NOT (${ACTIVE_LEADERSHIP_PREDICATE_SQL})
       JOIN users u ON u.id = ur.user_id
       JOIN members member ON member.id = ur.member_id
       LEFT JOIN organizations organization ON organization.id = member.organization_id
       JOIN identities identity ON identity.id = ur.identity_id
       LEFT JOIN user_emails selected_email ON selected_email.id = identity.email_id
      WHERE source_group.id = ?
      ORDER BY ends_at DESC, starts_at DESC, ${LEADERSHIP_ORDER_SQL}`,
    [groupId],
  );
  return rows.map(mapLeadership);
}

export async function listEffectiveGroupLeadership(
  db: DatabaseLike,
  groupIdOrSlug: string,
): Promise<GroupLeadershipListResponse> {
  const group = await getGroup(db, groupIdOrSlug);
  if (!group) throw new AppError(404, "GROUP_NOT_FOUND", "Group not found");
  const titles = await first<{ lead_title: string; deputy_lead_title: string }>(
    db,
    "SELECT lead_title, deputy_lead_title FROM group_types WHERE key = ?",
    [group.type.key],
  );
  if (!titles) throw new AppError(500, "GROUP_TYPE_MISSING", "The group's type is not configured");
  const [assignments, past] = await Promise.all([
    listCurrentLeadership(db, group.id),
    listPastLeadership(db, group.id),
  ]);
  return {
    group: { id: group.id, slug: group.slug, name: group.name, type: group.type },
    governanceInheritanceMode: group.governanceInheritanceMode,
    titles: { lead: titles.lead_title, deputyLead: titles.deputy_lead_title },
    assignments,
    past,
  };
}

/** Splits one requested end instant into the authorization columns it means. */
function termEndColumns(endsAt: string | null, now: string): { revokedAt: string | null; expiresAt: string | null } {
  if (!endsAt) return { revokedAt: null, expiresAt: null };
  return endsAt <= now ? { revokedAt: endsAt, expiresAt: null } : { revokedAt: null, expiresAt: endsAt };
}

function translateLeadershipWriteError(error: unknown): never {
  if (isAuthorizationGuardFailure(error)) {
    throw new AppError(409, "GROUP_MANAGEMENT_CHANGED", "Group management permission changed before commit");
  }
  if (isAuditChangeGuardFailure(error)) {
    throw new AppError(409, "GROUP_LEADERSHIP_CHANGED", "Group leadership changed before commit");
  }
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("uq_user_roles_active_user_role_context")) {
    throw new AppError(409, "GROUP_LEADERSHIP_EXISTS", "This active group leadership assignment already exists");
  }
  if (message.includes("USER_ROLE_CONTEXT_INVALID")) {
    throw new AppError(
      409,
      "GROUP_LEADER_CAPACITY_INVALID",
      "The person no longer participates in this group through that Member capacity",
    );
  }
  throw error;
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
  const end = termEndColumns(input.endsAt ?? null, at);
  const closedTerm = end.revokedAt !== null;
  // A live assignment needs a live capacity; a closed historical term only
  // needs the capacity the person once held, so a former chair can be
  // recorded after their representation ended.
  const capacity = await first<{ identity_id: string; member_id: string }>(
    db,
    `SELECT membership.identity_id, membership.member_id
       FROM group_memberships membership
       JOIN users user ON user.id = membership.user_id${closedTerm ? "" : " AND user.active = 1"}
       JOIN members member ON member.id = membership.member_id${closedTerm ? "" : " AND member.status = 'active'"}
      WHERE membership.group_id = ?
        AND membership.user_id = ?
        AND membership.identity_id = ?
        ${closedTerm ? "" : "AND membership.left_at IS NULL"}
      ORDER BY membership.left_at IS NULL DESC, membership.joined_at DESC
      LIMIT 1`,
    [groupId, input.userId, input.identityId],
  );
  if (!capacity) {
    throw new AppError(
      400,
      "GROUP_LEADER_CAPACITY_INVALID",
      closedTerm
        ? "The selected person never participated in this group through that Member capacity"
        : "The selected person is not actively participating in this group through that Member capacity",
    );
  }
  if (
    !closedTerm &&
    (await first(
      db,
      `SELECT id FROM user_roles
        WHERE user_id = ? AND identity_id = ? AND role_id = ? AND context_type = 'group' AND context_id = ?
          AND revoked_at IS NULL`,
      [input.userId, input.identityId, roleId, groupId],
    ))
  ) {
    throw new AppError(409, "GROUP_LEADERSHIP_EXISTS", "This active group leadership assignment already exists");
  }
  const titles = await first<{ lead_title: string; deputy_lead_title: string }>(
    db,
    `SELECT gt.lead_title, gt.deputy_lead_title
       FROM groups g JOIN group_types gt ON gt.key = g.type_key
      WHERE g.id = ?`,
    [groupId],
  );
  if (!titles) throw new AppError(404, "GROUP_NOT_FOUND", "Group not found");
  const title =
    input.title ??
    defaultGroupLeadershipTitle({ lead: titles.lead_title, deputyLead: titles.deputy_lead_title }, roleId);
  const startsAt = input.startsAt ?? at;
  const userRoleId = uuid();
  try {
    await db.batch([
      prepareGroupManagementAuthorizationGuard(db, actor, [groupId]),
      db
        .prepare(
          `INSERT INTO user_roles
             (id, user_id, identity_id, member_id, role_id, context_type, context_id, title, starts_at,
              granted_by_user_id, single_holder_per_context, expires_at, revoked_at, created_at)
           VALUES (?, ?, ?, ?, ?, 'group', ?, ?, ?, ?, 0, ?, ?, ?)`,
        )
        .bind(
          userRoleId,
          input.userId,
          capacity.identity_id,
          capacity.member_id,
          roleId,
          groupId,
          title,
          startsAt,
          adminDatabaseUserId(actor),
          end.expiresAt,
          end.revokedAt,
          at,
        ),
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
          identityId: capacity.identity_id,
          memberId: capacity.member_id,
          roleId,
          title,
          startsAt,
          endsAt: input.endsAt ?? null,
        },
      ),
    ]);
  } catch (error) {
    translateLeadershipWriteError(error);
  }
}

interface LocalAssignmentRow {
  id: string;
  governance_inheritance_mode: string;
  title: string | null;
  starts_at: string | null;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
}

async function requireLocalAssignment(
  db: DatabaseLike,
  groupId: string,
  userRoleId: string,
): Promise<LocalAssignmentRow> {
  const assignment = await first<LocalAssignmentRow>(
    db,
    `SELECT ur.id, g.governance_inheritance_mode, ur.title, ur.starts_at, ur.created_at, ur.expires_at, ur.revoked_at
       FROM user_roles ur JOIN groups g ON g.id = ur.context_id
      WHERE ur.id = ? AND ur.context_type = 'group' AND ur.context_id = ?
        AND ${LEADERSHIP_ROLE_PREDICATE_SQL}`,
    [userRoleId, groupId],
  );
  if (!assignment) throw new AppError(404, "GROUP_LEADERSHIP_NOT_FOUND", "Local leadership assignment not found");
  return assignment;
}

/**
 * The SQL that keeps local-only governance from losing its last leader: an
 * update that would close the last active local term is a no-op, which the
 * audit-change guard then reports as a conflict.
 */
const LOCAL_LEADERSHIP_REMAINS_SQL = `(
  EXISTS (SELECT 1 FROM groups g WHERE g.id = ? AND g.governance_inheritance_mode <> 'local_only')
  OR EXISTS (
    SELECT 1 FROM user_roles alternative
     WHERE alternative.context_type = 'group' AND alternative.context_id = ?
       AND alternative.role_id IN ('role-group_lead', 'role-group_deputy_lead')
       AND alternative.revoked_at IS NULL AND alternative.id <> ?
       AND (alternative.expires_at IS NULL OR alternative.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )
)`;

async function assertLocalLeadershipRemains(db: DatabaseLike, groupId: string, userRoleId: string): Promise<void> {
  const remains = await first<{ ok: number }>(db, `SELECT 1 AS ok WHERE ${LOCAL_LEADERSHIP_REMAINS_SQL}`, [
    groupId,
    groupId,
    userRoleId,
  ]);
  if (!remains) {
    throw new AppError(409, "GROUP_LOCAL_LEADERSHIP_REQUIRED", "Local-only governance requires a local leader");
  }
}

export async function updateLocalGroupLeadership(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupId: string,
  userRoleId: string,
  patch: GroupLeadershipUpdateInput,
): Promise<void> {
  await requireGroupManagement(db, actor, groupId);
  const assignment = await requireLocalAssignment(db, groupId, userRoleId);
  const at = nowIso();
  const currentlyActive =
    assignment.revoked_at === null && (assignment.expires_at === null || assignment.expires_at > at);
  const startsAt = patch.startsAt ?? assignment.starts_at ?? assignment.created_at;
  const requestedEnd = patch.endsAt === undefined ? (assignment.revoked_at ?? assignment.expires_at) : patch.endsAt;
  if (requestedEnd && requestedEnd < startsAt) {
    throw new AppError(400, "GROUP_LEADERSHIP_TERM_INVALID", "The term cannot end before it starts");
  }
  const end = termEndColumns(requestedEnd, at);
  const willBeActive = end.revokedAt === null;
  if (currentlyActive && !willBeActive) await assertLocalLeadershipRemains(db, groupId, userRoleId);

  const setters = ["starts_at = ?", "expires_at = ?", "revoked_at = ?"];
  const bindings: unknown[] = [startsAt, end.expiresAt, end.revokedAt];
  if (patch.title !== undefined) {
    setters.push("title = ?");
    bindings.push(patch.title);
  }
  try {
    await db.batch([
      prepareGroupManagementAuthorizationGuard(db, actor, [groupId]),
      db
        .prepare(
          `UPDATE user_roles SET ${setters.join(", ")}
            WHERE id = ? AND context_type = 'group' AND context_id = ?
              AND role_id IN ('role-group_lead', 'role-group_deputy_lead')
              AND (${willBeActive ? "1" : LOCAL_LEADERSHIP_REMAINS_SQL})`,
        )
        .bind(...bindings, userRoleId, groupId, ...(willBeActive ? [] : [groupId, groupId, userRoleId])),
      prepareScopedAuditLogAfterOneChange(
        db,
        { type: "group", id: groupId },
        "admin",
        actor.id,
        "group_leadership_updated",
        "user_role",
        userRoleId,
        { ...patch, startsAt, endsAt: requestedEnd },
      ),
    ]);
  } catch (error) {
    translateLeadershipWriteError(error);
  }
}

export async function revokeLocalGroupLeadership(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupId: string,
  userRoleId: string,
): Promise<void> {
  await requireGroupManagement(db, actor, groupId);
  const assignment = await first<{ id: string }>(
    db,
    `SELECT ur.id
       FROM user_roles ur
      WHERE ur.id = ? AND ur.context_type = 'group' AND ur.context_id = ?
        AND ${LEADERSHIP_ROLE_PREDICATE_SQL}
        AND ur.revoked_at IS NULL`,
    [userRoleId, groupId],
  );
  if (!assignment)
    throw new AppError(404, "GROUP_LEADERSHIP_NOT_FOUND", "Active local leadership assignment not found");
  await assertLocalLeadershipRemains(db, groupId, userRoleId);
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
              AND ${LOCAL_LEADERSHIP_REMAINS_SQL}`,
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
    translateLeadershipWriteError(error);
  }
}
