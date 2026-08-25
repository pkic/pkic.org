import type { MailingListPreferenceMutation } from "./types";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike } from "../../types";
import { nowIso } from "../../utils/time";
import { prepareScopedAuditLog } from "../audit";
import { buildEnqueueGoogleGroupsSyncStatement } from "../google-groups/sync-queue";
import { canMemberAccessGroupResource } from "../resource-grants/access";
import { getEffectiveMailingListSubscription, resolveGroupId } from "./read-model";

/** Persist one member preference and enqueue its provider-state transition atomically. */
export async function setMailingListPreference(
  db: DatabaseLike,
  userId: string,
  groupIdOrSlug: string,
  listId: string,
  preference: MailingListPreferenceMutation,
) {
  const groupId = await resolveGroupId(db, groupIdOrSlug);
  const canView = await canMemberAccessGroupResource(db, userId, "mailingList", listId, "view", groupId);
  if (!canView) {
    throw new AppError(404, "MAILING_LIST_NOT_FOUND", "Mailing list is not available through this group");
  }
  if (
    preference === "subscribed" &&
    !(await canMemberAccessGroupResource(db, userId, "mailingList", listId, "subscribe", groupId))
  ) {
    throw new AppError(403, "MAILING_LIST_SUBSCRIPTION_INELIGIBLE", "The caller cannot subscribe through this group");
  }
  const current = await getEffectiveMailingListSubscription(db, userId, listId);
  if (preference === "subscribed" && !current.eligible) {
    throw new AppError(403, "MAILING_LIST_SUBSCRIPTION_INELIGIBLE", "The caller is not eligible for this mailing list");
  }
  const storedPreference = preference === "inherit" ? null : preference;
  if (current.preference === storedPreference) return current;

  const at = nowIso();
  const statements: StatementLike[] = [];
  if (storedPreference) {
    statements.push(
      db
        .prepare(
          `INSERT INTO mailing_list_subscription_preferences
             (mailing_list_id, user_id, preference, updated_by_user_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(mailing_list_id, user_id) DO UPDATE SET
             preference = excluded.preference,
             updated_by_user_id = excluded.updated_by_user_id,
             updated_at = excluded.updated_at`,
        )
        .bind(listId, userId, storedPreference, userId, at, at),
    );
  } else {
    statements.push(
      db
        .prepare("DELETE FROM mailing_list_subscription_preferences WHERE mailing_list_id = ? AND user_id = ?")
        .bind(listId, userId),
    );
  }

  const effectiveSubscribed =
    storedPreference === "subscribed"
      ? true
      : storedPreference === "unsubscribed"
        ? false
        : current.eligible && current.defaultSubscribed;
  const desiredAction = effectiveSubscribed ? "add_to_list" : "remove_from_list";
  const desired = await first<{ desired_action: string }>(
    db,
    `SELECT desired_action FROM google_groups_membership_desired_state
      WHERE user_id = ? AND google_group_email = ?`,
    [userId, current.mailingList.email],
  );
  if ((desired === null && effectiveSubscribed) || (desired !== null && desired.desired_action !== desiredAction)) {
    statements.push(
      buildEnqueueGoogleGroupsSyncStatement(db, {
        userId,
        googleGroupEmail: current.mailingList.email,
        action: desiredAction,
        idempotencyKey: `mailing-list-preference:${listId}:${userId}:${preference}:${at}`,
      }).statement,
    );
  }
  statements.push(
    prepareScopedAuditLog(
      db,
      { type: "group", id: groupId },
      "member",
      userId,
      "mailing_list_preference_changed",
      "mailing_list",
      listId,
      { from: current.preference, to: storedPreference },
      at,
    ),
  );
  await db.batch(statements);
  return getEffectiveMailingListSubscription(db, userId, listId);
}
