import type { MembershipCategoryCatalogEntry } from "../../../../../assets/shared/schemas/membership-categories";
import { prepareMembershipWorkflowPin, requireCategoryWorkflow } from "../workflows/pinning";
import { prepareMembershipWorkflowRestart } from "../workflows/restart";
import { isApplicationTerminalStage } from "../../../../../assets/shared/schemas/member-applications";
import { prepareAuthorizationGuard } from "../../../db/authorization-guard";
import { first } from "../../../db/queries";
import { AppError } from "../../../errors";
import type { DatabaseLike, StatementLike } from "../../../types";
import type { MemberApplicationRow } from "./queries";

/** Corrections cannot silently reuse a decision, dispatched notice, or existing checkout. */
export async function prepareApplicationEditEvidenceGuard(
  db: DatabaseLike,
  application: MemberApplicationRow,
  nextCategory: MembershipCategoryCatalogEntry,
  now: string,
): Promise<StatementLike[]> {
  const categoryChanged = nextCategory.code !== application.membership_category;
  if (categoryChanged && isApplicationTerminalStage(application.stage))
    throw new AppError(409, "MEMBERSHIP_APPLICATION_CLOSED", "Closed applications cannot change category.");
  const workflow = await first<{ generation: number; revision: number }>(
    db,
    "SELECT generation, revision FROM membership_application_workflows WHERE application_id = ? AND superseded_at IS NULL",
    [application.id],
  );
  if (categoryChanged) {
    const target = await requireCategoryWorkflow(db, nextCategory);
    return workflow
      ? prepareMembershipWorkflowRestart(db, application.id, workflow, nextCategory, target, now)
      : prepareMembershipWorkflowPin(db, application.id, nextCategory, target, 1, now);
  }
  if (!workflow) return [];
  if (isApplicationTerminalStage(application.stage)) return [];
  const evidence = {
    sql: `SELECT 1 FROM membership_application_workflows workflow
      WHERE workflow.application_id = ? AND workflow.generation = ? AND workflow.revision = ? AND workflow.superseded_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM membership_application_steps step WHERE step.application_id = workflow.application_id
          AND step.generation = workflow.generation AND (step.completed_at IS NOT NULL OR step.notice_outbox_id IS NOT NULL))
        AND NOT EXISTS (SELECT 1 FROM membership_fee_intents fee WHERE fee.application_id = workflow.application_id AND fee.generation = workflow.generation)`,
    bindings: [application.id, workflow.generation, workflow.revision],
  };
  if (!(await first(db, evidence.sql, evidence.bindings)))
    throw new AppError(
      409,
      "MEMBERSHIP_REVIEW_RESTART_REQUIRED",
      "Review evidence already exists. Preview and confirm a workflow restart before changing the application details; previous objections remain recorded.",
    );
  return [prepareAuthorizationGuard(db, evidence)];
}
