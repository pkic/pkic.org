import type { DatabaseLike } from "../../types";
import { prepareJobWake } from "../scheduled-jobs/dispatcher";

/** Queue current memberships after a verified additional-address change. */
export function prepareMailingListAddressSync(db: DatabaseLike, userId: string, at: string) {
  return [
    db
      .prepare(`INSERT INTO google_groups_sync_queue
      (id,user_id,action,google_group_email,status,attempts,next_attempt_at,created_at)
      SELECT 'mailing-list-email-change:' || lower(hex(randomblob(16))),user_id,desired_action,
        google_group_email,'pending',0,?,? FROM google_groups_membership_desired_state WHERE user_id = ?`)
      .bind(at, at, userId),
    prepareJobWake(db, "google_groups_sync"),
  ];
}

/** A new primary mailbox also resets its old presence evidence; suppression survives. */
export function prepareMailingListEmailChange(db: DatabaseLike, userId: string, at: string) {
  return [
    ...prepareMailingListAddressSync(db, userId, at),
    // An unsubscribe retains its confirmed-presence evidence and suppression.
    // Only an explicit resubscribe may release that history; an address change
    // resets the current-mailbox observations without opting the person in.
    db
      .prepare(`UPDATE google_groups_observed_membership
      SET confirmed_subscribed_at = CASE WHEN unsubscribed_at IS NULL THEN NULL ELSE confirmed_subscribed_at END,
      last_observed_present_at = NULL,last_observed_absent_at = NULL,updated_at = ? WHERE user_id = ?`)
      .bind(at, userId),
  ];
}
