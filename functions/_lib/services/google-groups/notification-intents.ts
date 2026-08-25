import { first } from "../../db/queries";
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
     AND queue.status = 'completed'
     AND queue.action = 'add_to_list'`;

/**
 * Builds notification inserts for one successful add. The returned
 * statements must be committed in the same D1 batch as queue completion. The
 * enrollment intent is one row per queue item so the later drain can preserve
 * the existing one-email-per-user grouping. Meeting participation is owned by
 * canonical group events; Google mailing-list sync must not query or deliver
 * the superseded uploaded-ICS calendar model.
 */
export async function prepareGoogleGroupsSyncNotificationStatements(
  db: DatabaseLike,
  claim: ClaimedGoogleGroupsSyncRow,
  memberEmail: string,
  syncPassId: string,
): Promise<StatementLike[]> {
  if (claim.action !== "add_to_list") return [];

  const user = await first<{ email: string; first_name: string | null; last_name: string | null }>(
    db,
    "SELECT email, first_name, last_name FROM users WHERE id = ?",
    [claim.user_id],
  );
  if (!user) throw new Error("User disappeared while preparing Google Groups notification intents");

  const memberName = [user.first_name, user.last_name].filter(Boolean).join(" ") || memberEmail;
  return [
    db
      .prepare(
        `INSERT INTO google_groups_enrollment_notification_intents
           (queue_id, user_id, sync_pass_id, google_group_email, recipient_email, member_name, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (${CURRENT_ADD_STATE_CONDITION})
         ON CONFLICT(queue_id) DO NOTHING`,
      )
      .bind(claim.id, claim.user_id, syncPassId, claim.google_group_email, user.email, memberName, nowIso(), claim.id),
  ];
}
