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
import type { GroupLeadershipAssignInput, GroupLeadershipUpdateInput } from "../../../../assets/shared/schemas/groups";
import { GROUP_LEADERSHIP_ROLE_IDS, defaultGroupLeadershipTitle } from "../../../../assets/shared/schemas/groups";
import { adminDatabaseUserId } from "../../auth/admin-identity";
import { isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike } from "../../types";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { isAuditChangeGuardFailure, prepareScopedAuditLogAfterOneChange } from "../audit";
import { prepareGroupManagementAuthorizationGuard, requireGroupManagement } from "./governance";
import { LEADERSHIP_ROLE_PREDICATE_SQL } from "./leadership-read";
import { buildLeadershipSeatStatement, resolveEligibleLeadershipCapacity } from "./leadership-seating";

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
  /*
   * Nobody seated? Seat them, if the group would have them.
   *
   * Refusing here is what made the All Members forum's leadership picker
   * useless (issue #26): a group whose participation follows from affiliation
   * has no seats at all, so every appointment was refused until a manager
   * knew to add the person on the Members tab first — a two-step workflow
   * nobody could guess. A chair is a participant, so the appointment says so
   * and writes the seat in the same batch as the grant. The group's own
   * eligibility rules still decide; this does not let a manager appoint
   * somebody the group would not accept.
   */
  const startsAt = input.startsAt ?? at;
  const seat = capacity ?? (await resolveEligibleLeadershipCapacity(db, groupId, input, closedTerm));
  /*
   * Only a live term seats anybody.
   *
   * A closed term is a record of a role, not of participation, and writing a
   * closed seat beside it puts the same person in "Past positions" twice —
   * once as the chair they were and once as a plain member for the same
   * dates. A former seat is its own fact, recorded on the Members tab.
   */
  const seatStatements =
    capacity || closedTerm
      ? []
      : [
          buildLeadershipSeatStatement(db, actor, {
            groupId,
            userId: input.userId,
            seat,
            joinedAt: startsAt,
            at,
          }),
        ];
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
  const userRoleId = uuid();
  try {
    await db.batch([
      prepareGroupManagementAuthorizationGuard(db, actor, [groupId]),
      ...seatStatements,
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
          seat.identity_id,
          seat.member_id,
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
          identityId: seat.identity_id,
          memberId: seat.member_id,
          roleId,
          title,
          startsAt,
          endsAt: input.endsAt ?? null,
          // The appointment seated them as well, which is a fact about the
          // group's roster and not only about the grant.
          seated: seatStatements.length > 0,
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
