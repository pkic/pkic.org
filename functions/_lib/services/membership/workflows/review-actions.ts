import type { z } from "zod";
import type { membershipWorkflowActionSchema } from "../../../../../assets/shared/schemas/membership-workflows";
import { AppError } from "../../../errors";
import type { DatabaseLike } from "../../../types";
import { nowIso } from "../../../utils/time";
import { getMembershipExecution } from "./execution";
import { commitMembershipWorkflow } from "./evaluate";
import { requireWorkflowReviewer, type MembershipReviewer } from "./reviewer-eligibility";

export async function completeMembershipStaffReview(
  db: DatabaseLike,
  applicationId: string,
  actor: MembershipReviewer,
  input: z.infer<typeof membershipWorkflowActionSchema>,
  appBaseUrl: string,
) {
  const execution = await getMembershipExecution(db, applicationId);
  if (execution.revision !== input.expectedRevision)
    throw new AppError(
      409,
      "MEMBERSHIP_WORKFLOW_CHANGED",
      "The application changed. Reload before completing this review.",
    );
  const position = execution.currentPosition;
  const step = execution.version.definition.steps[position];
  const row = execution.steps[position];
  if (execution.application.stage === "on_hold" || step?.kind !== "staff_review" || row?.state !== "active")
    throw new AppError(409, "MEMBERSHIP_REVIEW_NOT_ACTIVE", "This application has no active staff review to complete.");
  const authorization = await requireWorkflowReviewer(db, step, actor);
  const now = nowIso();
  // Evaluation sees the proposed evidence; the transaction writes it only with live authorization.
  row.completed_at = now;
  row.state = "complete";
  return commitMembershipWorkflow(
    db,
    execution,
    appBaseUrl,
    {
      actor: actor.staff ?? null,
      actorUserId: actor.userId,
      reason: input.reason,
      statements: [
        authorization,
        db
          .prepare(
            `UPDATE membership_application_steps
      SET state = 'complete', completed_at = ?, completed_by_user_id = ?, completion_reason = ?
      WHERE application_id = ? AND generation = ? AND position = ? AND state = 'active' AND completed_at IS NULL`,
          )
          .bind(now, actor.userId, input.reason, applicationId, execution.generation, position),
      ],
    },
    now,
  );
}
