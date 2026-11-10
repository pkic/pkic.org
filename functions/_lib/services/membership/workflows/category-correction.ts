import type { MembershipCategoryCatalogEntry } from "../../../../../assets/shared/schemas/membership-categories";
import type { MembershipWorkflowVersion } from "../../../../../assets/shared/schemas/membership-workflows";
import { prepareAuthorizationGuard } from "../../../db/authorization-guard";
import type { DatabaseLike, StatementLike } from "../../../types";
import { prepareCategoryWorkflowGuard } from "./pinning";
import { prepareRemoveMembershipReviewSnapshots } from "./review-digest-content";

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
          AND NOT EXISTS (SELECT 1 FROM membership_fee_intents fee
            WHERE fee.application_id = workflow.application_id AND fee.generation = workflow.generation)`,
      bindings: [applicationId, current.generation, current.revision, version.id],
    }),
    prepareCategoryWorkflowGuard(db, category, version),
    ...prepareRemoveMembershipReviewSnapshots(db, applicationId, now),
    // Runs after the snapshot removal, which may cancel a digest left empty.
    db
      .prepare(
        `UPDATE membership_application_steps SET state = 'waiting', notice_outbox_id = NULL, opened_at = NULL, deadline_at = NULL
        WHERE application_id = ? AND generation = ? AND completed_at IS NULL
          AND notice_outbox_id IN (SELECT id FROM email_outbox
            WHERE sent_at IS NULL AND status IN ('queued', 'retrying', 'failed', 'cancelled'))`,
      )
      .bind(applicationId, current.generation),
    db
      .prepare(
        `UPDATE membership_application_workflows
        SET category_code = ?, category_revision = ?, revision = revision + 1, next_evaluation_at = ?
        WHERE application_id = ? AND generation = ? AND superseded_at IS NULL`,
      )
      .bind(category.code, category.revision, now, applicationId, current.generation),
  ];
}
