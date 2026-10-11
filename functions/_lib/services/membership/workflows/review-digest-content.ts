import { prepareAuthorizationGuard } from "../../../db/authorization-guard";
import type { DatabaseLike, StatementLike } from "../../../types";

/** Both enqueueing and removal rebuild the same rendered summaries from snapshots. */
export const MEMBERSHIP_REVIEW_DIGEST_CONTENT_SQL = `json_set(updated.payload_json,
  '$.applicationSummary', COALESCE((SELECT group_concat(json_extract(entry.value, '$.summary'), '') FROM json_each(updated.payload_json, '$.reviewApplications') entry), ''),
  '$.applicationDetails', COALESCE((SELECT group_concat(json_extract(entry.value, '$.details'), '') FROM json_each(updated.payload_json, '$.reviewApplications') entry), ''))`;

/** Remove every unsent snapshot inside the application's state-change command boundary. */
export function prepareRemoveMembershipReviewSnapshots(
  db: DatabaseLike,
  applicationId: string,
  now: string,
): StatementLike[] {
  const path = `$.reviewApplications."${applicationId}"`;
  const notices = `SELECT step.notice_outbox_id FROM membership_application_steps step
    WHERE step.application_id = ? AND step.notice_outbox_id IS NOT NULL`;
  return [
    // Once delivery owns a notice it cannot be recalled. Retry the state change after
    // that attempt finishes instead of changing review eligibility during an active send.
    prepareAuthorizationGuard(db, {
      sql: `SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM email_outbox
        WHERE id IN (${notices}) AND status = 'sending' AND json_type(payload_json, ?) IS NOT NULL)`,
      bindings: [applicationId, path],
    }),
    db
      .prepare(
        `WITH updated AS MATERIALIZED (
        SELECT id, json_remove(payload_json, ?) AS payload_json FROM email_outbox
        WHERE id IN (${notices}) AND status IN ('queued', 'retrying')
          AND json_type(payload_json, ?) IS NOT NULL
      )
      UPDATE email_outbox SET
        payload_json = (SELECT ${MEMBERSHIP_REVIEW_DIGEST_CONTENT_SQL} FROM updated WHERE updated.id = email_outbox.id),
        status = CASE WHEN (SELECT COUNT(*) FROM updated, json_each(updated.payload_json, '$.reviewApplications') entry
          WHERE updated.id = email_outbox.id) = 0 THEN 'cancelled' ELSE status END,
        updated_at = ?
      WHERE id IN (SELECT id FROM updated)`,
      )
      .bind(path, applicationId, path, now),
  ];
}
