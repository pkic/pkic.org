import { AppError } from "../../errors";
import { findEligibleMemberById } from "../../auth/member";
import { first } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { prepareAuditLog } from "../audit";
import {
  assertCaConstraint,
  buildAddWorkingGroupMemberStatements,
  buildRemoveWorkingGroupMemberStatements,
  getWorkingGroupBySlugOrId,
} from "../working-groups";

export async function addMemberToWorkingGroup(
  db: DatabaseLike,
  actorUserId: string,
  workingGroupId: string,
  targetUserId: string,
): Promise<void> {
  const workingGroup = await getWorkingGroupBySlugOrId(db, workingGroupId);
  if (!workingGroup) {
    throw new AppError(404, "WORKING_GROUP_NOT_FOUND", "Working group not found");
  }

  const targetUser = await first<{ id: string }>(db, "SELECT id FROM users WHERE id = ?", [targetUserId]);
  if (!targetUser) {
    throw new AppError(404, "USER_NOT_FOUND", "User not found");
  }

  // A staff action has no member-session context, so eligibility must cover
  // every active affiliation rather than selecting an arbitrary membership.
  const eligibleMember = await findEligibleMemberById(db, targetUserId);
  const activeMemberships = eligibleMember?.activeMemberships ?? [];
  assertCaConstraint(
    workingGroup,
    activeMemberships.map((membership) => membership.membershipCategory),
  );

  // Persist a member id only when the affiliation is unambiguous.
  const memberId = activeMemberships.length === 1 ? activeMemberships[0].memberId : null;
  const statements = await buildAddWorkingGroupMemberStatements(db, workingGroup, targetUserId, memberId);
  if (statements.length === 0) return;
  statements.push(
    prepareAuditLog(db, "admin", actorUserId, "working_group_member_added", "working_group", workingGroup.id, {
      userId: targetUserId,
    }),
  );
  await db.batch(statements);
}

export async function removeMemberFromWorkingGroup(
  db: DatabaseLike,
  actorUserId: string,
  workingGroupId: string,
  targetUserId: string,
): Promise<void> {
  const workingGroup = await getWorkingGroupBySlugOrId(db, workingGroupId);
  if (!workingGroup) {
    throw new AppError(404, "WORKING_GROUP_NOT_FOUND", "Working group not found");
  }
  const statements = await buildRemoveWorkingGroupMemberStatements(db, workingGroup, targetUserId);
  if (statements.length === 0) return;
  statements.push(
    prepareAuditLog(db, "admin", actorUserId, "working_group_member_removed", "working_group", workingGroup.id, {
      userId: targetUserId,
    }),
  );
  await db.batch(statements);
}
