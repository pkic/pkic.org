import { all, run } from "../../db/queries";
import { logInfo } from "../../logging";
import type { DatabaseLike } from "../../types";
import type { GoogleGroupsDirectoryClient } from "./contracts";

const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

export interface ObservationResult {
  groupsObserved: number;
  groupsSkippedIncomplete: number;
  confirmed: number;
  unsubscribesDetected: number;
}

interface ExpectedMemberRow {
  user_id: string;
  email: string;
}

/**
 * Reconciles our record of who is in a Google Group against the provider's.
 *
 * This pass is deliberately DETECT-ONLY. It never enqueues an add, because the
 * one thing a diff cannot distinguish is "never added yet" from "added, then
 * left". Treating absence as a gap to close would silently re-subscribe every
 * person who unsubscribed on the Google side, overriding a consent decision.
 *
 * Adds only ever originate from a local event — a new member, an explicit
 * subscribe. Absence only ever produces a record that they are gone.
 */
export async function observeGoogleGroupsMembership(
  db: DatabaseLike,
  client: GoogleGroupsDirectoryClient,
  options: { groupEmails: readonly string[]; maxPagesPerGroup?: number },
): Promise<ObservationResult> {
  const result: ObservationResult = {
    groupsObserved: 0,
    groupsSkippedIncomplete: 0,
    confirmed: 0,
    unsubscribesDetected: 0,
  };

  for (const googleGroupEmail of options.groupEmails) {
    const listing = await client.listMembers(googleGroupEmail, options.maxPagesPerGroup);
    if (!listing.complete) {
      // A truncated listing would make present members look absent.
      result.groupsSkippedIncomplete += 1;
      logInfo("GOOGLE_GROUPS_OBSERVATION_INCOMPLETE", { googleGroupEmail });
      continue;
    }
    result.groupsObserved += 1;
    const present = new Set(listing.emails);

    // Everyone we believe should be, or has been, in this group.
    const expected = await all<ExpectedMemberRow>(
      db,
      `SELECT DISTINCT desired.user_id AS user_id, lower(users.email) AS email
         FROM google_groups_membership_desired_state desired
         JOIN users ON users.id = desired.user_id
        WHERE desired.google_group_email = ?
          AND desired.desired_action = 'add_to_list'
        UNION
       SELECT observed.user_id AS user_id, lower(users.email) AS email
         FROM google_groups_observed_membership observed
         JOIN users ON users.id = observed.user_id
        WHERE observed.google_group_email = ?
          AND observed.confirmed_subscribed_at IS NOT NULL`,
      [googleGroupEmail, googleGroupEmail],
    );

    for (const member of expected) {
      if (present.has(member.email)) {
        await recordPresence(db, member.user_id, googleGroupEmail);
        result.confirmed += 1;
        continue;
      }
      // Absent. Only meaningful once presence was actually confirmed —
      // otherwise this is simply someone queued but not yet added.
      const detected = await recordAbsence(db, member.user_id, googleGroupEmail);
      if (detected) result.unsubscribesDetected += 1;
    }
  }

  if (result.unsubscribesDetected > 0) {
    logInfo("GOOGLE_GROUPS_UNSUBSCRIBES_DETECTED", { detected: result.unsubscribesDetected });
  }
  return result;
}

async function recordPresence(db: DatabaseLike, userId: string, googleGroupEmail: string): Promise<void> {
  await run(
    db,
    `INSERT INTO google_groups_observed_membership
       (user_id, google_group_email, confirmed_subscribed_at, last_observed_present_at)
     VALUES (?, ?, ${NOW_SQL}, ${NOW_SQL})
     ON CONFLICT(user_id, google_group_email) DO UPDATE
        SET last_observed_present_at = ${NOW_SQL},
            confirmed_subscribed_at = COALESCE(confirmed_subscribed_at, ${NOW_SQL}),
            updated_at = ${NOW_SQL}`,
    [userId, googleGroupEmail],
  );
}

/** Returns true when this observation newly established an unsubscribe. */
async function recordAbsence(db: DatabaseLike, userId: string, googleGroupEmail: string): Promise<boolean> {
  const outcome = await run(
    db,
    `UPDATE google_groups_observed_membership
        SET last_observed_absent_at = ${NOW_SQL},
            unsubscribed_at = ${NOW_SQL},
            unsubscribe_source = 'provider_absence',
            suppressed = 1,
            updated_at = ${NOW_SQL}
      WHERE user_id = ?
        AND google_group_email = ?
        AND confirmed_subscribed_at IS NOT NULL
        AND unsubscribed_at IS NULL`,
    [userId, googleGroupEmail],
  );
  if (outcome.changes > 0) return true;

  // Never confirmed present: record the absence without claiming a leave.
  await run(
    db,
    `INSERT INTO google_groups_observed_membership (user_id, google_group_email, last_observed_absent_at)
     VALUES (?, ?, ${NOW_SQL})
     ON CONFLICT(user_id, google_group_email) DO UPDATE
        SET last_observed_absent_at = ${NOW_SQL}, updated_at = ${NOW_SQL}`,
    [userId, googleGroupEmail],
  );
  return false;
}

/**
 * True when this person has left this group and has not explicitly asked to
 * rejoin. The add path must consult this: reconciliation must never undo a
 * consent decision.
 */
export async function isGoogleGroupsSuppressed(
  db: DatabaseLike,
  userId: string,
  googleGroupEmail: string,
): Promise<boolean> {
  const rows = await all<{ suppressed: number }>(
    db,
    `SELECT suppressed FROM google_groups_observed_membership
      WHERE user_id = ? AND google_group_email = ? AND suppressed = 1`,
    [userId, googleGroupEmail],
  );
  return rows.length > 0;
}

/** Clears suppression for an explicit, person-initiated resubscribe only. */
export async function clearGoogleGroupsSuppression(
  db: DatabaseLike,
  userId: string,
  googleGroupEmail: string,
): Promise<void> {
  await run(
    db,
    `UPDATE google_groups_observed_membership
        SET suppressed = 0, unsubscribed_at = NULL, unsubscribe_source = NULL, updated_at = ${NOW_SQL}
      WHERE user_id = ? AND google_group_email = ?`,
    [userId, googleGroupEmail],
  );
}
