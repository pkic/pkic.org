import type { MembershipCategoryCatalogEntry } from "../../../../../assets/shared/schemas/membership-categories";
import type { MembershipWorkflowVersion } from "../../../../../assets/shared/schemas/membership-workflows";
import { prepareAuthorizationGuard } from "../../../db/authorization-guard";
import type { DatabaseLike, StatementLike } from "../../../types";
import { prepareCategoryWorkflowGuard } from "./pinning";
import { MEMBERSHIP_WORKFLOW_HAS_FEE_SQL } from "./fee-evidence";
import { prepareRemoveMembershipReviewSnapshots, prepareReopenUndeliveredReviewSteps } from "./review-digest-content";

/**
 * Correct the category of an application whose new category pins the same
 * workflow version. Completed steps, delivered notices, and objections stay in
 * the current generation. A notice not yet delivered still carries the old
 * category, so its snapshot is withdrawn and the step reopens with a fresh one.
 * A recorded fee is bound to its category, so callers restart instead.
 */
export function prepareMembershipWorkflowCategoryCorrection(
  db: DatabaseLike,
  applicationId: string,
  current: { generation: number; revision: number },
  category: MembershipCategoryCatalogEntry,
  version: MembershipWorkflowVersion,
  now: string,
): StatementLike[] {
  return [
    prepareAuthorizationGuard(db, {
      sql: `SELECT 1 FROM membership_application_workflows workflow
        WHERE workflow.application_id = ? AND workflow.generation = ? AND workflow.revision = ?
          AND workflow.version_id = ? AND workflow.superseded_at IS NULL
          AND NOT ${MEMBERSHIP_WORKFLOW_HAS_FEE_SQL}`,
      bindings: [applicationId, current.generation, current.revision, version.id],
    }),
    prepareCategoryWorkflowGuard(db, category, version),
    ...prepareRemoveMembershipReviewSnapshots(db, applicationId, now),
    prepareReopenUndeliveredReviewSteps(db, applicationId),
    db
      .prepare(
        `UPDATE membership_application_workflows
        SET category_code = ?, category_revision = ?, revision = revision + 1, next_evaluation_at = ?
        WHERE application_id = ? AND generation = ? AND superseded_at IS NULL`,
      )
      .bind(category.code, category.revision, now, applicationId, current.generation),
  ];
}
