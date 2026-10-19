import type { MembershipCategoryCatalogEntry } from "../../../../../assets/shared/schemas/membership-categories";
import type { MembershipWorkflowVersion } from "../../../../../assets/shared/schemas/membership-workflows";
import { prepareAuthorizationGuard } from "../../../db/authorization-guard";
import type { DatabaseLike, StatementLike } from "../../../types";
import { prepareMembershipWorkflowPin } from "./pinning";
import { prepareRemoveMembershipReviewSnapshots } from "./review-digest-content";

/** Restart evidence atomically for an explicit workflow migration or a category correction. */
export function prepareMembershipWorkflowRestart(
  db: DatabaseLike,
  applicationId: string,
  current: { generation: number; revision: number },
  category: MembershipCategoryCatalogEntry,
  target: MembershipWorkflowVersion,
  now: string,
  explicitVersion = false,
): StatementLike[] {
  return [
    prepareAuthorizationGuard(db, {
      sql: `SELECT 1 FROM membership_application_workflows WHERE application_id = ?
        AND generation = ? AND revision = ? AND superseded_at IS NULL`,
      bindings: [applicationId, current.generation, current.revision],
    }),
    ...prepareRemoveMembershipReviewSnapshots(db, applicationId, now),
    db
      .prepare(
        "UPDATE membership_application_workflows SET superseded_at = ?, next_evaluation_at = NULL WHERE application_id = ? AND superseded_at IS NULL",
      )
      .bind(now, applicationId),
    ...prepareMembershipWorkflowPin(db, applicationId, category, target, current.generation + 1, now, explicitVersion),
    db
      .prepare(
        "UPDATE membership_fee_intents SET handling_required = 1, updated_at = ? WHERE application_id = ? AND status = 'paid'",
      )
      .bind(now, applicationId),
  ];
}
