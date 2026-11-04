import type { MailingListPreferenceMutation } from "./types";
import { adminDatabaseUserId } from "../../auth/admin-identity";
import { first } from "../../db/queries";
import { isAuthorizationGuardFailure, prepareAuthorizationGuard } from "../../db/authorization-guard";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike, StatementLike } from "../../types";
import { nowIso } from "../../utils/time";
import { prepareScopedAuditLog } from "../audit";
import { buildEnqueueGoogleGroupsSyncStatement } from "../google-groups/sync-queue";
import { canMemberAccessGroupResource, prepareMemberGroupResourceAuthorizationGuard } from "../resource-grants/access";
import { getEffectiveMailingListSubscription, resolveGroupId } from "./read-model";
import { requireManagedGroupMailingList, groupMailingListWriteGuards } from "../mailing-list-management/authorization";
import { EFFECTIVE_SUBSCRIPTION_CTE } from "./projection";

/** Persist one member preference and enqueue its provider-state transition atomically. */
export async function setMailingListPreference(
  db: DatabaseLike,
  userId: string,
  groupIdOrSlug: string,
  listId: string,
  preference: MailingListPreferenceMutation,
  actor?: AuthAdmin,
) {
  const groupId = await resolveGroupId(db, groupIdOrSlug);
  if (actor) await requireManagedGroupMailingList(db, actor, groupId, listId);
  const requiresMembership = preference === "subscribed" || preference === "archive_only";
  const user = await first(
    db,
    "SELECT id FROM users WHERE id = ? AND active = 1 AND pii_redacted_at IS NULL AND merged_into_user_id IS NULL",
    [userId],
  );
  if (!user) throw new AppError(404, "USER_NOT_FOUND", "Active user not found");
  const canView = actor || (await canMemberAccessGroupResource(db, userId, "mailingList", listId, "view", groupId));
  if (!canView) {
    throw new AppError(404, "MAILING_LIST_NOT_FOUND", "Mailing list is not available through this group");
  }
  if (
    !actor &&
    requiresMembership &&
    !(await canMemberAccessGroupResource(db, userId, "mailingList", listId, "subscribe", groupId))
  ) {
    throw new AppError(403, "MAILING_LIST_SUBSCRIPTION_INELIGIBLE", "The caller cannot subscribe through this group");
  }
  const current = await getEffectiveMailingListSubscription(db, userId, listId);
  if (requiresMembership && !current.eligible) {
    throw new AppError(403, "MAILING_LIST_SUBSCRIPTION_INELIGIBLE", "The caller is not eligible for this mailing list");
  }
  const storedPreference = preference === "inherit" ? null : preference;
  if (current.preference === storedPreference) return current;

  const at = nowIso();
  const statements: StatementLike[] = [
    ...(actor
      ? groupMailingListWriteGuards(db, actor, groupId, listId)
      : [prepareMemberGroupResourceAuthorizationGuard(db, userId, groupId, "mailingList", listId, "view")]),
    prepareAuthorizationGuard(db, {
      sql: "SELECT 1 FROM mailing_lists WHERE id = ? AND active = 1 AND archived_at IS NULL",
      bindings: [listId],
    }),
    prepareAuthorizationGuard(db, {
      sql: "SELECT 1 FROM users WHERE id = ? AND active = 1 AND pii_redacted_at IS NULL AND merged_into_user_id IS NULL",
      bindings: [userId],
    }),
  ];
  if (requiresMembership) {
    statements.push(
      ...(!actor
        ? [prepareMemberGroupResourceAuthorizationGuard(db, userId, groupId, "mailingList", listId, "subscribe")]
        : []),
      prepareAuthorizationGuard(db, {
        sql: `${EFFECTIVE_SUBSCRIPTION_CTE}
              SELECT 1 FROM effective_subscriptions WHERE id = ? AND eligible = 1`,
        bindings: [userId, listId],
      }),
    );
  }
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
        .bind(listId, userId, storedPreference, actor ? adminDatabaseUserId(actor) : userId, at, at),
    );
  } else {
    statements.push(
      db
        .prepare("DELETE FROM mailing_list_subscription_preferences WHERE mailing_list_id = ? AND user_id = ?")
        .bind(listId, userId),
    );
  }

  if (requiresMembership) {
    statements.push(
      db
        .prepare(`UPDATE google_groups_observed_membership
      SET suppressed = 0, unsubscribed_at = NULL, unsubscribe_source = NULL,
          confirmed_subscribed_at = NULL, updated_at = ?
      WHERE user_id = ? AND google_group_email = ?`)
        .bind(at, userId, current.mailingList.email),
    );
  }

  const effectiveMembership =
    storedPreference === "subscribed" || storedPreference === "archive_only"
      ? true
      : storedPreference === "unsubscribed"
        ? false
        : current.eligible && current.defaultSubscribed;
  const desiredAction = effectiveMembership ? "add_to_list" : "remove_from_list";
  statements.push(
    buildEnqueueGoogleGroupsSyncStatement(db, {
      userId,
      googleGroupEmail: current.mailingList.email,
      action: desiredAction,
      idempotencyKey: `mailing-list-preference:${listId}:${userId}:${preference}:${at}`,
    }).statement,
  );
  statements.push(
    prepareScopedAuditLog(
      db,
      { type: "group", id: groupId },
      actor ? "admin" : "member",
      actor?.id ?? userId,
      "mailing_list_preference_changed",
      "mailing_list",
      listId,
      { userId, from: current.preference, to: storedPreference },
      at,
    ),
  );
  try {
    await db.batch(statements);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(
        409,
        "MAILING_LIST_AUTHORIZATION_CHANGED",
        "Mailing-list eligibility changed while the preference was being saved",
      );
    }
    throw error;
  }
  return getEffectiveMailingListSubscription(db, userId, listId);
}
