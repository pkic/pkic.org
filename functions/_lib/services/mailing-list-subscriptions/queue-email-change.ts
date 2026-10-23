import type { DatabaseLike } from "../../types";
import { prepareJobWake } from "../scheduled-jobs/dispatcher";

/** Joins the email-change transaction; full reconciliation removes obsolete addresses. */
export function prepareMailingListEmailChange(db: DatabaseLike, userId: string, at: string) {
  return [
    db
      .prepare(`INSERT INTO google_groups_sync_queue
      (id,user_id,action,google_group_email,status,attempts,next_attempt_at,created_at)
      SELECT 'mailing-list-email-change:' || lower(hex(randomblob(16))),user_id,desired_action,
        google_group_email,'pending',0,?,? FROM google_groups_membership_desired_state WHERE user_id = ?`)
      .bind(at, at, userId),
    db
      .prepare(`UPDATE google_groups_observed_membership SET confirmed_subscribed_at = NULL,
      last_observed_present_at = NULL,last_observed_absent_at = NULL,updated_at = ? WHERE user_id = ?`)
      .bind(at, userId),
    prepareJobWake(db, "google_groups_sync"),
  ];
}
