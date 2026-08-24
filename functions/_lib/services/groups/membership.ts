import type {
  GroupCapacitySelection,
  GroupLeaveInput,
  GroupMembershipMutationResponse,
  GroupMembershipSource,
} from "../../../../assets/shared/schemas/groups";
import { buildD1JsonMembershipFilter } from "../../db/json-membership";
import { all, first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike } from "../../types";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { prepareScopedAuditLog } from "../audit";
import { prepareReconcileMailingListSubscriptionsStatement } from "../mailing-list-subscriptions";
import { selectGroupCapacities } from "./capacities";
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

export interface JoinGroupOptions {
  actorUserId: string;
  targetUserId: string;
  selection: GroupCapacitySelection;
  source: GroupMembershipSource;
  allowManaged: boolean;
}

/** Adds the selected capacity set atomically and idempotently. */
export async function joinGroup(
  db: DatabaseLike,
  idOrSlug: string,
  options: JoinGroupOptions,
): Promise<GroupMembershipMutationResponse> {
  const group = await requireGroupIdentity(db, idOrSlug);
  const capacities = await selectGroupCapacities(db, group.id, options.targetUserId, options.selection, {
    allowManaged: options.allowManaged,
  });
  const at = nowIso();
  const statements: StatementLike[] = capacities.map((capacity) =>
    db
      .prepare(
        `INSERT OR IGNORE INTO group_memberships
           (id, group_id, user_id, member_id, source, created_by_user_id,
            joined_at, left_at, created_at, updated_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?
          WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND active = 1)`,
      )
      .bind(
        uuid(),
        group.id,
        options.targetUserId,
        capacity.memberId,
        options.source,
        options.actorUserId,
        at,
        at,
        at,
        options.targetUserId,
      ),
  );
  statements.push(
    prepareReconcileMailingListSubscriptionsStatement(db, options.targetUserId, at),
    prepareScopedAuditLog(
      db,
      { type: "group", id: group.id },
      options.source === "self_service" ? "member" : "admin",
      options.actorUserId,
      "group_joined",
      "group",
      group.id,
      {
        targetUserId: options.targetUserId,
        memberIds: capacities.map((capacity) => capacity.memberId),
        source: options.source,
      },
    ),
  );
  await db.batch(statements);
  return mutationResponse(db, group.id, options.targetUserId, []);
}

export interface LeaveGroupOptions {
  actorUserId: string;
  targetUserId: string;
  selection: GroupLeaveInput;
  actorType: "member" | "admin" | "system";
}

/** Ends capacities without deleting history; descendant ending is enforced by D1. */
export async function leaveGroup(
  db: DatabaseLike,
  idOrSlug: string,
  options: LeaveGroupOptions,
): Promise<GroupMembershipMutationResponse> {
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
  await db.batch([
    db
      .prepare(`UPDATE group_memberships SET left_at = ?, updated_at = ? WHERE ${conditions.join(" AND ")}`)
      .bind(at, at, ...bindings),
    prepareReconcileMailingListSubscriptionsStatement(db, options.targetUserId, at),
    prepareScopedAuditLog(
      db,
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
  ]);
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
  actorUserId: string,
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
    actorUserId,
    targetUserId: membership.user_id,
    selection: { mode: "selected", memberIds: [membership.member_id] },
    actorType: "admin",
  });
}
