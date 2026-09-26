import type { MembershipWorkflowStep } from "../../../../../assets/shared/schemas/membership-workflows";
import { executiveCouncilSeatSql, EXECUTIVE_COUNCIL_GROUP_SLUG } from "../../../auth/executive-council";
import { hasPermission, preparePermissionsAuthorizationGuard } from "../../../auth/permissions";
import { prepareAuthorizationGuard, type AuthorizationEvidence } from "../../../db/authorization-guard";
import { first } from "../../../db/queries";
import { AppError } from "../../../errors";
import type { DatabaseLike, StatementLike, UserBackedAuthAdmin } from "../../../types";
import { activeVotingMemberCapacitySelect } from "../categories";

export interface MembershipReviewer {
  userId: string;
  staff?: UserBackedAuthAdmin;
}
function groupReviewer(groupId: string, userId: string, userExpression = "?"): AuthorizationEvidence {
  return {
    sql: `SELECT 1 FROM users reviewer
      JOIN group_memberships seat ON seat.user_id = reviewer.id AND seat.left_at IS NULL
      JOIN groups reviewer_group ON reviewer_group.id = seat.group_id AND reviewer_group.active = 1
      WHERE reviewer.id = ${userExpression} AND reviewer.active = 1 AND reviewer.pii_redacted_at IS NULL
        AND reviewer.merged_into_user_id IS NULL AND reviewer_group.id = ?`,
    bindings: [...(userExpression === "?" ? [userId] : []), groupId],
  };
}
/** Uses the existing live voting-capacity and council-roster policies, never the notice address. */
export function consensusReviewerEvidence(
  step: Extract<MembershipWorkflowStep, { kind: "consensus" }>,
  userId: string,
  userExpression: "?" | "u.id" = "?",
): AuthorizationEvidence {
  if (step.audience.kind === "group") return groupReviewer(step.audience.groupId, userId, userExpression);
  if (step.audience.kind === "executive_council")
    return {
      sql: `SELECT 1 FROM users WHERE id = ${userExpression} AND active = 1 AND pii_redacted_at IS NULL AND merged_into_user_id IS NULL
      AND ${executiveCouncilSeatSql("users.id")}
      AND EXISTS (SELECT 1 FROM groups WHERE slug = ? AND active = 1)`,
      bindings: [...(userExpression === "?" ? [userId] : []), EXECUTIVE_COUNCIL_GROUP_SLUG],
    };
  return {
    sql: `SELECT 1 FROM members candidate WHERE EXISTS (${activeVotingMemberCapacitySelect("candidate.id", userExpression)}) LIMIT 1`,
    bindings: userExpression === "?" ? [userId] : [],
  };
}
export async function requireWorkflowReviewer(
  db: DatabaseLike,
  step: MembershipWorkflowStep,
  actor: MembershipReviewer,
): Promise<StatementLike> {
  if (step.kind === "payment")
    throw new AppError(409, "MEMBERSHIP_PAYMENT_REQUIRED", "Only a verified payment can satisfy this step");
  if (step.kind === "staff_review" && !step.reviewerGroupId) {
    if (!actor.staff || !hasPermission(actor.staff, "membership:approve"))
      throw new AppError(403, "MEMBERSHIP_REVIEW_FORBIDDEN", "This step requires membership approval permission");
    return preparePermissionsAuthorizationGuard(db, actor.staff, [{ permission: "membership:approve" }]);
  }
  const evidence =
    step.kind === "consensus"
      ? consensusReviewerEvidence(step, actor.userId)
      : groupReviewer(step.reviewerGroupId!, actor.userId);
  if (!(await first(db, evidence.sql, [...evidence.bindings])))
    throw new AppError(403, "MEMBERSHIP_REVIEW_FORBIDDEN", "You are not currently eligible to review this step");
  return prepareAuthorizationGuard(db, evidence);
}
