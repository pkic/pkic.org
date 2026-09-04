import type {
  GroupCapacitySelection,
  GroupLeaveInput,
  GroupMembershipMutationResponse,
  GroupMembershipSource,
  GroupMembershipUpdateInput,
} from "../../../../assets/shared/schemas/groups";
import { buildD1JsonMembershipFilter } from "../../db/json-membership";
import { isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { all, first } from "../../db/queries";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike, StatementLike } from "../../types";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import {
  isAuditChangeGuardFailure,
  prepareAuditLogWhen,
  prepareScopedAuditLogAfterExpectedChanges,
  prepareScopedAuditLogAfterOneChange,
} from "../audit";
import { prepareReconcileMailingListSubscriptionsStatement } from "../mailing-list-subscriptions";
import { prepareGroupJoinEligibilityGuard, selectGroupCapacities } from "./capacities";
import { prepareGroupManagementAuthorizationGuard } from "./governance";
import { getGroup, listActiveGroupMembershipsForUser } from "./read-model";

async function requireGroupIdentity(db: DatabaseLike, idOrSlug: string): Promise<{ id: string; slug: string }> {
  const group = await first<{ id: string; slug: string }>(db, "SELECT id, slug FROM groups WHERE id = ? OR slug = ?", [
    idOrSlug,
    idOrSlug,
  ]);
  if (!group) throw new AppError(404, "GROUP_NOT_FOUND", "Group not found");
  return group;
}

async function mutationResponse(
  db: DatabaseLike,
  groupId: string,
  userId: string,
  endedMembershipIds: string[],
): Promise<GroupMembershipMutationResponse> {
  const [group, memberships] = await Promise.all([
    getGroup(db, groupId),
    listActiveGroupMembershipsForUser(db, groupId, userId),
  ]);
  if (!group) throw new AppError(500, "GROUP_READ_FAILED", "Failed to load the updated group");
  return {
    group: { id: group.id, slug: group.slug, name: group.name, type: group.type },
    memberships,
    endedMembershipIds,
  };
}

/** A seat's roster title and service interval, all optional on a live join. */
export interface GroupSeatDetails {
  title?: string | null;
  /** Backdates the seat; defaults to the command instant. */
  joinedAt?: string;
}

interface JoinGroupBaseOptions extends GroupSeatDetails {
  actorUserId: string;
  actorDatabaseUserId?: string | null;
  targetUserId: string;
  selection: GroupCapacitySelection;
}

export type JoinGroupOptions = JoinGroupBaseOptions &
  (
    | { source: "staff"; allowManaged: true; managementActor: AuthAdmin }
    | {
        source: Exclude<GroupMembershipSource, "staff">;
        allowManaged: boolean;
        managementActor?: never;
      }
  );

export interface BuildGroupCapacityJoinOptions extends GroupSeatDetails {
  groupId: string;
  targetUserId: string;
  memberIds: readonly string[];
  source: GroupMembershipSource;
  actorUserId: string | null;
  actorDatabaseUserId?: string | null;
  allowManaged: boolean;
  at: string;
}

/**
 * Builds the canonical capacity-level join command for an outer D1 batch.
 * This is shared by ordinary group joins and membership provisioning, where
 * the user, Member, and representation may be created earlier in that same
 * atomic batch and therefore cannot be resolved by a pre-write service call.
 */
export function buildGroupCapacityJoinStatements(
  db: DatabaseLike,
  options: BuildGroupCapacityJoinOptions,
): StatementLike[] {
  const memberIds = [...new Set(options.memberIds)];
  if (memberIds.length === 0) throw new Error("At least one Member capacity is required");
  const plannedMemberships = memberIds.map((memberId) => ({ id: uuid(), memberId }));
  const statements: StatementLike[] = [
    prepareGroupJoinEligibilityGuard(db, options.groupId, options.targetUserId, memberIds, {
      allowManaged: options.allowManaged,
    }),
    ...plannedMemberships.map(({ id, memberId }) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO group_memberships
             (id, group_id, user_id, identity_id, member_id, source, created_by_user_id,
              title, joined_at, left_at, created_at, updated_at)
           SELECT ?, ?, ?, capacity.identity_id, ?, ?, ?, ?, ?, NULL, ?, ?
             FROM identity_member_capacities capacity
             JOIN identities identity ON identity.id = capacity.identity_id
             JOIN users user ON user.id = capacity.user_id AND user.active = 1
            WHERE capacity.user_id = ?
              AND capacity.member_id = ?
              AND capacity.member_status = 'active'
              AND identity.started_at IS NOT NULL
              AND identity.ended_at IS NULL
              AND identity.blocked_at IS NULL`,
        )
        .bind(
          id,
          options.groupId,
          options.targetUserId,
          memberId,
          options.source,
          options.actorDatabaseUserId === undefined ? options.actorUserId : options.actorDatabaseUserId,
          options.title ?? null,
          options.joinedAt ?? options.at,
          options.at,
          options.at,
          options.targetUserId,
          memberId,
        ),
    ),
  ];
  const insertedMembershipFilter = buildD1JsonMembershipFilter(
    "id",
    plannedMemberships.map((membership) => membership.id),
  );
  statements.push(
    prepareAuditLogWhen(db, {
      actorType:
        options.source === "self_service" ? "member" : options.source === "automatic_policy" ? "system" : "admin",
      actorId: options.actorUserId,
      action: "group_joined",
      entityType: "group",
      entityId: options.groupId,
      details: {
        targetUserId: options.targetUserId,
        requestedMemberIds: memberIds,
        source: options.source,
      },
      conditionSql: `SELECT 1 FROM group_memberships WHERE ${insertedMembershipFilter.sql}`,
      conditionBindings: insertedMembershipFilter.bindings,
      createdAt: options.at,
      scope: { type: "group", id: options.groupId },
    }),
  );
  return statements;
}

/** Adds the selected capacity set atomically and idempotently. */
export async function joinGroup(
  db: DatabaseLike,
  idOrSlug: string,
  options: JoinGroupOptions,
): Promise<GroupMembershipMutationResponse> {
  if (options.source === "staff" && !options.managementActor) {
    throw new Error("Staff group joins require a management actor");
  }
  if (options.source !== "staff" && options.allowManaged) {
    throw new Error("Only staff group joins may bypass self-service eligibility");
  }
  const group = await requireGroupIdentity(db, idOrSlug);
  const capacities = await selectGroupCapacities(db, group.id, options.targetUserId, options.selection, {
    allowManaged: options.allowManaged,
  });
  const at = nowIso();
  const statements: StatementLike[] = [
    ...(options.managementActor
      ? [prepareGroupManagementAuthorizationGuard(db, options.managementActor, [group.id])]
      : []),
    ...buildGroupCapacityJoinStatements(db, {
      groupId: group.id,
      targetUserId: options.targetUserId,
      memberIds: capacities.map((capacity) => capacity.memberId),
      source: options.source,
      actorUserId: options.actorUserId,
      actorDatabaseUserId: options.actorDatabaseUserId,
      allowManaged: options.allowManaged,
      title: options.title,
      joinedAt: options.joinedAt,
      at,
    }),
    prepareReconcileMailingListSubscriptionsStatement(db, options.targetUserId, at),
  ];
  try {
    await db.batch(statements);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(
        409,
        "GROUP_JOIN_CONTEXT_CHANGED",
        "Group eligibility or management authority changed while the membership was being saved; reload and retry",
      );
    }
    throw error;
  }
  return mutationResponse(db, group.id, options.targetUserId, []);
}

interface LeaveGroupBaseOptions {
  actorUserId: string;
  targetUserId: string;
  selection: GroupLeaveInput;
}

export type LeaveGroupOptions = LeaveGroupBaseOptions &
  ({ actorType: "admin"; managementActor: AuthAdmin } | { actorType: "member" | "system"; managementActor?: never });

/** Ends capacities without deleting history; descendant ending is enforced by D1. */
export async function leaveGroup(
  db: DatabaseLike,
  idOrSlug: string,
  options: LeaveGroupOptions,
): Promise<GroupMembershipMutationResponse> {
  if (options.actorType === "admin" && !options.managementActor) {
    throw new Error("Admin group removals require a management actor");
  }
  const group = await requireGroupIdentity(db, idOrSlug);
  const conditions = ["group_id = ?", "user_id = ?", "left_at IS NULL"];
  const bindings: unknown[] = [group.id, options.targetUserId];
  if (options.selection.mode === "selected") {
    const filter = buildD1JsonMembershipFilter("member_id", [...new Set(options.selection.memberIds)]);
    conditions.push(filter.sql);
    bindings.push(...filter.bindings);
  }
  const active = await all<{ id: string; member_id: string }>(
    db,
    `SELECT id, member_id FROM group_memberships WHERE ${conditions.join(" AND ")} ORDER BY id`,
    bindings,
  );
  if (options.selection.mode === "selected") {
    const foundMemberIds = new Set(active.map((membership) => membership.member_id));
    if (options.selection.memberIds.some((memberId) => !foundMemberIds.has(memberId))) {
      throw new AppError(404, "GROUP_MEMBERSHIP_NOT_FOUND", "One or more selected group capacities are not active");
    }
  }
  if (active.length === 0) return mutationResponse(db, group.id, options.targetUserId, []);

  const at = nowIso();
  try {
    await db.batch([
      ...(options.managementActor
        ? [prepareGroupManagementAuthorizationGuard(db, options.managementActor, [group.id])]
        : []),
      db
        .prepare(`UPDATE group_memberships SET left_at = ?, updated_at = ? WHERE ${conditions.join(" AND ")}`)
        .bind(at, at, ...bindings),
      prepareScopedAuditLogAfterExpectedChanges(
        db,
        active.length,
        { type: "group", id: group.id },
        options.actorType,
        options.actorUserId,
        "group_left",
        "group",
        group.id,
        {
          targetUserId: options.targetUserId,
          membershipIds: active.map((membership) => membership.id),
          memberIds: active.map((membership) => membership.member_id),
        },
      ),
      prepareReconcileMailingListSubscriptionsStatement(db, options.targetUserId, at),
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(
        409,
        "GROUP_MANAGEMENT_AUTHORIZATION_CHANGED",
        "Group-management authority changed while the membership was being saved",
      );
    }
    if (isAuditChangeGuardFailure(error)) {
      throw new AppError(
        409,
        "GROUP_MEMBERSHIP_CHANGED",
        "Group membership changed while the leave was being saved; reload and retry",
      );
    }
    throw error;
  }
  return mutationResponse(
    db,
    group.id,
    options.targetUserId,
    active.map((membership) => membership.id),
  );
}

export async function endGroupMembership(
  db: DatabaseLike,
  groupIdOrSlug: string,
  membershipId: string,
  actor: AuthAdmin,
): Promise<GroupMembershipMutationResponse> {
  const group = await requireGroupIdentity(db, groupIdOrSlug);
  const membership = await first<{ user_id: string; member_id: string; left_at: string | null }>(
    db,
    "SELECT user_id, member_id, left_at FROM group_memberships WHERE id = ? AND group_id = ?",
    [membershipId, group.id],
  );
  if (!membership || membership.left_at !== null) {
    throw new AppError(404, "GROUP_MEMBERSHIP_NOT_FOUND", "Active group membership capacity not found");
  }
  return leaveGroup(db, group.id, {
    actorUserId: actor.id,
    targetUserId: membership.user_id,
    selection: { mode: "selected", memberIds: [membership.member_id] },
    actorType: "admin",
    managementActor: actor,
  });
}

export interface RecordFormerGroupMembershipOptions extends GroupSeatDetails {
  targetUserId: string;
  selection: GroupCapacitySelection;
  joinedAt: string;
  leftAt: string;
}

/**
 * Records a seat that already ended: a former Board member, a chair from
 * before the portal existed. The row is written closed, so it never grants
 * access and needs no live eligibility, only the capacity the person once
 * held. Any identity the person had for the Member qualifies, ended or not,
 * because the seat itself is history.
 */
export async function recordFormerGroupMembership(
  db: DatabaseLike,
  idOrSlug: string,
  actor: AuthAdmin,
  options: RecordFormerGroupMembershipOptions,
): Promise<GroupMembershipMutationResponse> {
  const group = await requireGroupIdentity(db, idOrSlug);
  const requested = options.selection.mode === "selected" ? [...new Set(options.selection.memberIds)] : null;
  const capacities = await all<{ identity_id: string; member_id: string }>(
    db,
    `SELECT capacity.identity_id, capacity.member_id
       FROM identity_member_capacities capacity
       JOIN identities identity ON identity.id = capacity.identity_id
       JOIN users user ON user.id = capacity.user_id
      WHERE capacity.user_id = ?
        AND identity.started_at IS NOT NULL
        ${requested ? "AND capacity.member_id IN (SELECT value FROM json_each(?))" : ""}
      ORDER BY capacity.member_id, identity.ended_at IS NULL DESC, identity.started_at DESC`,
    requested ? [options.targetUserId, JSON.stringify(requested)] : [options.targetUserId],
  );
  // One seat per Member: the most recent identity for each represents it.
  const seats = [...new Map(capacities.map((capacity) => [capacity.member_id, capacity])).values()];
  if (seats.length === 0 || (requested && seats.length !== requested.length)) {
    throw new AppError(
      403,
      "GROUP_CAPACITY_REQUIRED",
      "The person has no Member capacity, current or former, to record this seat through",
    );
  }
  const at = nowIso();
  const membershipIds = seats.map(() => uuid());
  try {
    await db.batch([
      prepareGroupManagementAuthorizationGuard(db, actor, [group.id]),
      ...seats.map((seat, index) =>
        db
          .prepare(
            `INSERT INTO group_memberships
               (id, group_id, user_id, identity_id, member_id, source, created_by_user_id,
                title, joined_at, left_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'staff', ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            membershipIds[index],
            group.id,
            options.targetUserId,
            seat.identity_id,
            seat.member_id,
            actor.identityType === "user" ? actor.id : null,
            options.title ?? null,
            options.joinedAt,
            options.leftAt,
            at,
            at,
          ),
      ),
      prepareScopedAuditLogAfterExpectedChanges(
        db,
        seats.length,
        { type: "group", id: group.id },
        "admin",
        actor.id,
        "group_former_membership_recorded",
        "group",
        group.id,
        {
          targetUserId: options.targetUserId,
          membershipIds,
          memberIds: seats.map((seat) => seat.member_id),
          title: options.title ?? null,
          joinedAt: options.joinedAt,
          leftAt: options.leftAt,
        },
      ),
    ]);
  } catch (error) {
    translateSeatWriteError(error);
  }
  return mutationResponse(db, group.id, options.targetUserId, []);
}

function translateSeatWriteError(error: unknown): never {
  if (isAuthorizationGuardFailure(error)) {
    throw new AppError(
      409,
      "GROUP_MANAGEMENT_AUTHORIZATION_CHANGED",
      "Group-management authority changed while the seat was being saved",
    );
  }
  if (isAuditChangeGuardFailure(error)) {
    throw new AppError(
      409,
      "GROUP_MEMBERSHIP_CHANGED",
      "The seat cannot be saved as requested; the capacity may no longer be active or the seat may already be open",
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("left_at IS NULL OR left_at >= joined_at")) {
    throw new AppError(400, "GROUP_MEMBERSHIP_INTERVAL_INVALID", "A seat cannot end before it starts");
  }
  if (message.includes("uq_group_memberships_active_capacity")) {
    throw new AppError(409, "GROUP_MEMBERSHIP_EXISTS", "This capacity already holds an open seat in the group");
  }
  if (message.includes("active identity required")) {
    throw new AppError(
      409,
      "GROUP_CAPACITY_REQUIRED",
      "An open seat needs an active Member capacity; the person's representation has ended",
    );
  }
  if (message.includes("active parent group membership required")) {
    throw new AppError(409, "GROUP_PARENT_MEMBERSHIP_REQUIRED", "Active parent group membership is required");
  }
  throw error;
}

/**
 * Edits one seat's title or service interval. Ending a seat revokes the
 * leadership held through it, as any leave does; reopening one requires the
 * exact capacity to still be active and no other open seat for it, which the
 * guarded UPDATE checks in the same D1 batch as the audit record.
 */
export async function updateGroupMembership(
  db: DatabaseLike,
  groupIdOrSlug: string,
  membershipId: string,
  actor: AuthAdmin,
  patch: GroupMembershipUpdateInput,
): Promise<GroupMembershipMutationResponse> {
  const group = await requireGroupIdentity(db, groupIdOrSlug);
  const seat = await first<{ user_id: string; joined_at: string; left_at: string | null }>(
    db,
    "SELECT user_id, joined_at, left_at FROM group_memberships WHERE id = ? AND group_id = ?",
    [membershipId, group.id],
  );
  if (!seat) throw new AppError(404, "GROUP_MEMBERSHIP_NOT_FOUND", "Group membership capacity not found");
  const joinedAt = patch.joinedAt ?? seat.joined_at;
  const leftAt = patch.leftAt === undefined ? seat.left_at : patch.leftAt;
  if (leftAt && leftAt < joinedAt) {
    throw new AppError(400, "GROUP_MEMBERSHIP_INTERVAL_INVALID", "A seat cannot end before it starts");
  }
  const reopening = seat.left_at !== null && leftAt === null;
  const at = nowIso();
  const setters = ["joined_at = ?", "left_at = ?", "updated_at = ?"];
  const bindings: unknown[] = [joinedAt, leftAt, at];
  if (patch.title !== undefined) {
    setters.push("title = ?");
    bindings.push(patch.title);
  }
  try {
    await db.batch([
      prepareGroupManagementAuthorizationGuard(db, actor, [group.id]),
      db
        .prepare(
          `UPDATE group_memberships SET ${setters.join(", ")}
            WHERE id = ? AND group_id = ?
              ${
                reopening
                  ? `AND EXISTS (
                       SELECT 1 FROM identity_member_capacities capacity
                       JOIN identities identity ON identity.id = capacity.identity_id
                       JOIN users user ON user.id = capacity.user_id AND user.active = 1
                      WHERE capacity.identity_id = group_memberships.identity_id
                        AND capacity.member_id = group_memberships.member_id
                        AND capacity.member_status = 'active'
                        AND identity.started_at IS NOT NULL
                        AND identity.ended_at IS NULL
                        AND identity.blocked_at IS NULL
                     )`
                  : ""
              }`,
        )
        .bind(...bindings, membershipId, group.id),
      prepareScopedAuditLogAfterOneChange(
        db,
        { type: "group", id: group.id },
        "admin",
        actor.id,
        "group_membership_updated",
        "group_membership",
        membershipId,
        { ...patch, joinedAt, leftAt },
      ),
      prepareReconcileMailingListSubscriptionsStatement(db, seat.user_id, at),
    ]);
  } catch (error) {
    translateSeatWriteError(error);
  }
  return mutationResponse(db, group.id, seat.user_id, leftAt && seat.left_at === null ? [membershipId] : []);
}
