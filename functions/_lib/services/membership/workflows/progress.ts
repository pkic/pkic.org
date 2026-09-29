import { isApplicationTerminalStage } from "../../../../../assets/shared/schemas/member-applications";
import { membershipReviewSummary } from "../../../../../assets/shared/membership-workflow-summary";
import {
  evaluateMembershipRequirement,
  evaluateMembershipWorkflow,
} from "../../../../../assets/shared/membership-workflow-evaluation";
import { membershipWorkflowProgressSchema } from "../../../../../assets/shared/schemas/membership-workflows";
import { getMembershipExecution, membershipStepEvidence, type MembershipExecution } from "./execution";
import { nowIso } from "../../../utils/time";
import type { DatabaseLike } from "../../../types";

/** Applicant-safe progress contains requirements and evidence state, never private objection bodies. */
export function membershipWorkflowProgress(execution: MembershipExecution, now = nowIso()) {
  const evidence = membershipStepEvidence(execution);
  const evaluation = evaluateMembershipWorkflow(execution.version.definition, evidence, execution.objections, now);
  return membershipWorkflowProgressSchema.parse({
    versionId: execution.version.id,
    name: execution.version.definition.name,
    version: execution.version.version,
    lifecycle: execution.application.stage,
    revision: execution.revision,
    steps: execution.version.definition.steps.map((step, position) => {
      const row = execution.steps[position];
      const requirement = evaluateMembershipRequirement(
        step,
        evidence[position],
        execution.objections.some((item) => item.unresolved && item.position <= position),
        now,
      );
      return {
        stepId: step.id,
        position,
        label: step.label,
        kind: step.kind,
        instructions: step.instructions,
        review: membershipReviewSummary(step, execution.referenceLabels),
        state:
          !isApplicationTerminalStage(execution.application.stage) &&
          step.kind === "payment" &&
          row.state === "complete" &&
          !requirement.complete
            ? "active"
            : row.state,
        openedAt: row.opened_at,
        deadlineAt: row.deadline_at,
        completedAt: row.completed_at,
        noticeStatus: row.notice_status,
        payment:
          step.kind === "payment"
            ? {
                amount: step.amount,
                currency: step.currency,
                status:
                  row.fee_status === "pending" && row.fee_deadline_at && row.fee_deadline_at <= now
                    ? "expired"
                    : (row.fee_status ?? "waiting"),
                checkoutUrl:
                  row.fee_status === "pending" &&
                  row.fee_handling_required !== 1 &&
                  row.fee_deadline_at &&
                  row.fee_deadline_at > now &&
                  row.checkout_expires_at &&
                  row.checkout_expires_at > now &&
                  !isApplicationTerminalStage(execution.application.stage) &&
                  execution.application.stage !== "on_hold"
                    ? row.checkout_url
                    : null,
                handlingRequired: row.fee_handling_required === 1,
              }
            : null,
        blocker:
          row.state === "active" || (step.kind === "payment" && !requirement.complete)
            ? execution.application.stage === "on_hold"
              ? "The application is on hold. Follow the instructions from the review team."
              : requirement.complete
                ? evaluation.blocker
                : requirement.blocker
            : null,
      };
    }),
  });
}
export async function getMembershipWorkflowProgress(db: DatabaseLike, applicationId: string) {
  return membershipWorkflowProgress(await getMembershipExecution(db, applicationId));
}
