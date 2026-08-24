import type { DatabaseLike, StatementLike } from "../../types";
import { nowIso } from "../../utils/time";
import { ALL_ACTIVE_USER_CAPACITIES_CTE } from "../membership/capacity-query";
import {
  EFFECTIVE_SUBSCRIPTION_CTE,
  EFFECTIVE_SUBSCRIPTION_VALUE_SQL,
  mailingListDefaultSubscribedSql,
  mailingListEligibilitySql,
} from "./projection";

/** Queues only effective subscription changes; D1 computes the projection. */
export function prepareReconcileMailingListSubscriptionsStatement(
  db: DatabaseLike,
  userId: string,
  at = nowIso(),
): StatementLike {
  return db
    .prepare(
      `${EFFECTIVE_SUBSCRIPTION_CTE},
       desired_subscriptions AS (
         SELECT id, email, ${EFFECTIVE_SUBSCRIPTION_VALUE_SQL} AS effective_subscribed
           FROM effective_subscriptions
       )
       INSERT INTO google_groups_sync_queue
         (id, user_id, action, google_group_email, idempotency_key, status, attempts,
          last_error, next_attempt_at, created_at, processed_at)
       SELECT 'google-sync:' || lower(hex(randomblob(16))), ?,
              CASE WHEN subscription.effective_subscribed = 1 THEN 'add_to_list' ELSE 'remove_from_list' END,
              subscription.email,
              'mailing-list-reconcile:' || ? || ':' || subscription.id || ':' || ?,
              'pending', 0, NULL, ?, ?, NULL
         FROM desired_subscriptions subscription
         LEFT JOIN google_groups_membership_desired_state desired
           ON desired.user_id = ? AND desired.google_group_email = subscription.email
        WHERE (desired.desired_action IS NULL AND subscription.effective_subscribed = 1)
           OR desired.desired_action != CASE
                WHEN subscription.effective_subscribed = 1 THEN 'add_to_list'
                ELSE 'remove_from_list'
              END
        ORDER BY subscription.email`,
    )
    .bind(userId, userId, userId, at, at, at, userId);
}

/** Reconciles every current or former participant against lists owned by one group. */
export function prepareReconcileGroupMailingListSubscriptionsStatement(
  db: DatabaseLike,
  groupId: string,
  at = nowIso(),
): StatementLike {
  return db
    .prepare(
      `${ALL_ACTIVE_USER_CAPACITIES_CTE},
       affected_users(user_id) AS (
         SELECT DISTINCT user_id FROM group_memberships WHERE group_id = ?
         UNION
         SELECT DISTINCT desired.user_id
           FROM google_groups_membership_desired_state desired
           JOIN mailing_lists list ON list.email = desired.google_group_email
          WHERE list.group_id = ?
       ),
       projected AS (
         SELECT user.user_id, list.id AS list_id, list.email,
                preference.preference,
                ${mailingListEligibilitySql("list", "user.user_id")} AS eligible,
                ${mailingListDefaultSubscribedSql("list", "user.user_id")} AS default_subscribed,
                list.active, list.archived_at
           FROM affected_users user
           JOIN mailing_lists list ON list.group_id = ?
      LEFT JOIN mailing_list_subscription_preferences preference
             ON preference.mailing_list_id = list.id
            AND preference.user_id = user.user_id
       ),
       effective_subscriptions AS (
         SELECT user_id, list_id, email, CASE
           WHEN active = 0 OR archived_at IS NOT NULL OR eligible = 0 THEN 0
           WHEN preference = 'subscribed' THEN 1
           WHEN preference = 'unsubscribed' THEN 0
           ELSE default_subscribed
         END AS subscribed
           FROM projected
       )
       INSERT INTO google_groups_sync_queue
         (id, user_id, action, google_group_email, idempotency_key, status, attempts,
          last_error, next_attempt_at, created_at, processed_at)
       SELECT 'google-sync:' || lower(hex(randomblob(16))), subscription.user_id,
              CASE WHEN subscription.subscribed = 1 THEN 'add_to_list' ELSE 'remove_from_list' END,
              subscription.email,
              'group-mailing-list-reconcile:' || ? || ':' || subscription.list_id || ':' ||
                subscription.user_id || ':' || ?,
              'pending', 0, NULL, ?, ?, NULL
         FROM effective_subscriptions subscription
    LEFT JOIN google_groups_membership_desired_state desired
           ON desired.user_id = subscription.user_id
          AND desired.google_group_email = subscription.email
        WHERE (desired.desired_action IS NULL AND subscription.subscribed = 1)
           OR desired.desired_action != CASE
                WHEN subscription.subscribed = 1 THEN 'add_to_list'
                ELSE 'remove_from_list'
              END
        ORDER BY subscription.email, subscription.user_id`,
    )
    .bind(groupId, groupId, groupId, groupId, at, at, at);
}

/** Applies a configuration change for one list without loading subscribers into Worker memory. */
export function prepareReconcileMailingListStatement(db: DatabaseLike, listId: string, at = nowIso()): StatementLike {
  return db
    .prepare(
      `${ALL_ACTIVE_USER_CAPACITIES_CTE},
       affected_users(user_id) AS (
         SELECT DISTINCT user_id FROM active_user_capacities
         UNION
         SELECT DISTINCT desired.user_id
           FROM google_groups_membership_desired_state desired
           JOIN mailing_lists list ON list.email = desired.google_group_email
          WHERE list.id = ?
         UNION
         SELECT user_id FROM mailing_list_subscription_preferences WHERE mailing_list_id = ?
       ),
       projected AS (
         SELECT user.user_id, list.id AS list_id, list.email,
                preference.preference,
                ${mailingListEligibilitySql("list", "user.user_id")} AS eligible,
                ${mailingListDefaultSubscribedSql("list", "user.user_id")} AS default_subscribed,
                list.active, list.archived_at
           FROM affected_users user
           JOIN mailing_lists list ON list.id = ?
      LEFT JOIN mailing_list_subscription_preferences preference
             ON preference.mailing_list_id = list.id
            AND preference.user_id = user.user_id
       ),
       effective AS (
         SELECT user_id, list_id, email, CASE
           WHEN active = 0 OR archived_at IS NOT NULL OR eligible = 0 THEN 0
           WHEN preference = 'subscribed' THEN 1
           WHEN preference = 'unsubscribed' THEN 0
           ELSE default_subscribed
         END AS subscribed
         FROM projected
       )
       INSERT INTO google_groups_sync_queue
         (id, user_id, action, google_group_email, idempotency_key, status, attempts,
          last_error, next_attempt_at, created_at, processed_at)
       SELECT 'google-sync:' || lower(hex(randomblob(16))), subscription.user_id,
              CASE WHEN subscription.subscribed = 1 THEN 'add_to_list' ELSE 'remove_from_list' END,
              subscription.email,
              'mailing-list-config-reconcile:' || subscription.list_id || ':' ||
                subscription.user_id || ':' || ?,
              'pending', 0, NULL, ?, ?, NULL
         FROM effective subscription
    LEFT JOIN google_groups_membership_desired_state desired
           ON desired.user_id = subscription.user_id
          AND desired.google_group_email = subscription.email
        WHERE (desired.desired_action IS NULL AND subscription.subscribed = 1)
           OR desired.desired_action != CASE
                WHEN subscription.subscribed = 1 THEN 'add_to_list'
                ELSE 'remove_from_list'
              END
        ORDER BY subscription.user_id`,
    )
    .bind(listId, listId, listId, at, at, at);
}

export async function reconcileMailingListSubscriptionsForUser(db: DatabaseLike, userId: string): Promise<number> {
  const result = await prepareReconcileMailingListSubscriptionsStatement(db, userId).run();
  return result.meta?.changes ?? 0;
}
