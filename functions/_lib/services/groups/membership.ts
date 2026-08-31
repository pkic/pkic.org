import type {
  GroupCapacitySelection,
  GroupLeaveInput,
  GroupMembershipMutationResponse,
  GroupMembershipSource,
} from "../../../../assets/shared/schemas/groups";
import { buildD1JsonMembershipFilter } from "../../db/json-membership";
import { isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { all, first } from "../../db/queries";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike, StatementLike } from "../../types";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { isAuditChangeGuardFailure, prepareAuditLogWhen, prepareScopedAuditLogAfterExpectedChanges } from "../audit";
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

interface JoinGroupBaseOptions {
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

export interface BuildGroupCapacityJoinOptions {
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
              joined_at, left_at, created_at, updated_at)
           SELECT ?, ?, ?, capacity.identity_id, ?, ?, ?, ?, NULL, ?, ?
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
          options.at,
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
