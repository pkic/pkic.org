import { prepareAuthorizationGuard } from "../../db/authorization-guard";
import { nowIso } from "../../utils/time";
import type { DatabaseLike, StatementLike } from "../../types";
import type { ClaimedGoogleGroupsSyncRow } from "./contracts";

const CURRENT_ADD_STATE_CONDITION = `
  SELECT 1
    FROM google_groups_sync_queue queue
    JOIN google_groups_membership_desired_state desired
      ON desired.user_id = queue.user_id
     AND desired.google_group_email = queue.google_group_email
     AND desired.generation = queue.generation
     AND desired.desired_action = queue.action
   WHERE queue.id = ?
     AND queue.status = 'processing' AND queue.processing_token = ?
     AND queue.action = 'add_to_list'`;

/**
 * Persist the enrollment intent before the provider effect. The drain only
 * delivers it once the queue item completes, so a retry cannot lose a notice.
 * Recipient and profile data are resolved from the user at delivery preparation.
 */
export function prepareGoogleGroupsSyncNotificationStatements(
  db: DatabaseLike,
  claim: ClaimedGoogleGroupsSyncRow,
  syncPassId: string,
): StatementLike[] {
  if (claim.action !== "add_to_list") return [];

  // Required legacy snapshot columns remain empty; the drain reads the current user.
  return [
    prepareAuthorizationGuard(db, { sql: CURRENT_ADD_STATE_CONDITION, bindings: [claim.id, claim.processing_token] }),
    db
      .prepare(
        `INSERT INTO google_groups_enrollment_notification_intents
           (queue_id, user_id, sync_pass_id, google_group_email, recipient_email, member_name, created_at)
         SELECT ?, ?, ?, ?, '', '', ?
          WHERE EXISTS (${CURRENT_ADD_STATE_CONDITION})
         ON CONFLICT(queue_id) DO NOTHING`,
      )
      .bind(claim.id, claim.user_id, syncPassId, claim.google_group_email, nowIso(), claim.id, claim.processing_token),
  ];
}
