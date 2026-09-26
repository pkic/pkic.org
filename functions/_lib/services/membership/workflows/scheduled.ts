import { all, run } from "../../../db/queries";
import { hasD1QueryCapacity, type D1QueryBudget } from "../../../db/query-budget";
import { AppError } from "../../../errors";
import { logError } from "../../../logging";
import type { DatabaseLike } from "../../../types";
import { nowIso } from "../../../utils/time";
import { evaluateMembershipApplication } from "./evaluate";

export const MEMBERSHIP_WORKFLOW_DUE_QUERY = `SELECT workflow.application_id, workflow.generation, workflow.revision FROM membership_application_workflows workflow
      WHERE workflow.superseded_at IS NULL AND workflow.next_evaluation_at <= ?
        AND EXISTS (SELECT 1 FROM member_applications application WHERE application.id = workflow.application_id
          AND application.stage IN ('submitted', 'processing'))
      ORDER BY workflow.next_evaluation_at, workflow.application_id LIMIT 10`;

/** Bounded discovery only: every actual transition uses the interactive evaluator. */
export async function runMembershipWorkflows(db: DatabaseLike, appBaseUrl: string, budget?: D1QueryBudget) {
  const now = nowIso();
  const rows = await all<{ application_id: string; generation: number; revision: number }>(
    db,
    MEMBERSHIP_WORKFLOW_DUE_QUERY,
    [now],
  );
  let evaluated = 0;
  for (const row of rows) {
    // Provisioning can queue group enrollments and several account notices.
    if (!hasD1QueryCapacity(budget, 200)) break;
    try {
      await evaluateMembershipApplication(db, row.application_id, appBaseUrl);
      evaluated++;
    } catch (error) {
      if (!(error instanceof AppError && error.status === 409)) throw error;
      logError("MEMBERSHIP_WORKFLOW_REQUIRES_REVIEW", { applicationId: row.application_id, code: error.code });
      await run(
        db,
        `UPDATE membership_application_workflows SET next_evaluation_at = ?
        WHERE application_id = ? AND generation = ? AND revision = ? AND superseded_at IS NULL`,
        [new Date(Date.parse(now) + 3600_000).toISOString(), row.application_id, row.generation, row.revision],
      );
    }
  }
  return { summary: { evaluated } };
}
