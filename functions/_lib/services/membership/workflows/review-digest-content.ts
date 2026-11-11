import { prepareAuthorizationGuard } from "../../../db/authorization-guard";
import type { DatabaseLike, StatementLike } from "../../../types";

const UNCLAIMED_REVIEW_NOTICE_STATUSES_SQL = "'queued', 'retrying', 'failed'";

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
        WHERE id IN (${notices}) AND sent_at IS NULL AND status IN (${UNCLAIMED_REVIEW_NOTICE_STATUSES_SQL})
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

/** Reopen only unopened reviews after snapshot removal, which can cancel an empty digest. */
export function prepareReopenUndeliveredReviewSteps(db: DatabaseLike, applicationId: string): StatementLike {
  return db
    .prepare(
      `UPDATE membership_application_steps SET state = 'waiting', notice_outbox_id = NULL, opened_at = NULL, deadline_at = NULL
      WHERE application_id = ? AND state = 'active' AND completed_at IS NULL AND opened_at IS NULL
        AND generation = (SELECT generation FROM membership_application_workflows
          WHERE application_id = ? AND superseded_at IS NULL)
        AND EXISTS (SELECT 1 FROM email_outbox notice
          WHERE notice.id = membership_application_steps.notice_outbox_id
            AND notice.sent_at IS NULL AND notice.status IN (${UNCLAIMED_REVIEW_NOTICE_STATUSES_SQL}, 'cancelled')
            AND json_type(notice.payload_json, '$.reviewApplications') = 'object')`,
    )
    .bind(applicationId, applicationId);
}
