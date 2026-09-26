import { preparePermissionsAuthorizationGuard } from "../../../auth/permissions";
import { AppError } from "../../../errors";
import type { AuthAdmin, DatabaseLike } from "../../../types";
import { evaluateMembershipWorkflow } from "../../../../../assets/shared/membership-workflow-evaluation";
import { nowIso } from "../../../utils/time";
import { getMembershipExecution, membershipStepEvidence } from "../workflows/execution";
import { commitMembershipWorkflow } from "../workflows/evaluate";

/** Explicit approval requests use the same evidence rules as scheduled and payment completion. */
export async function approveApplication(
  db: DatabaseLike,
  params: {
    applicationId: string;
    actor: AuthAdmin | null;
    loginUrl: string;
  },
) {
  const execution = await getMembershipExecution(db, params.applicationId);
  const now = nowIso();
  if (
    execution.application.stage === "on_hold" ||
    !evaluateMembershipWorkflow(
      execution.version.definition,
      membershipStepEvidence(execution),
      execution.objections,
      now,
    ).readyToProvision
  ) {
    throw new AppError(
      409,
      "MEMBERSHIP_REQUIREMENTS_INCOMPLETE",
      "Complete all required reviews, resolve objections, and verify any required fee before approval.",
    );
  }
  const result = await commitMembershipWorkflow(
    db,
    execution,
    new URL(params.loginUrl).origin,
    {
      actor: params.actor,
      actorUserId: params.actor?.id ?? null,
      reason: "Check that every requirement in the pinned workflow is satisfied",
      statements: params.actor
        ? [preparePermissionsAuthorizationGuard(db, params.actor, [{ permission: "membership:approve" }])]
        : [],
    },
    now,
  );
  if (!result.approval)
    throw new AppError(
      409,
      "MEMBERSHIP_REQUIREMENTS_INCOMPLETE",
      "Complete all required reviews, resolve objections, and verify any required fee before approval.",
    );
  return result.approval;
}
