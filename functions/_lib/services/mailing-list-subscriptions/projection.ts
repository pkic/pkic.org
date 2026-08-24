import { ACTIVE_USER_CAPACITIES_CTE } from "../membership/capacity-query";

export function mailingListEligibilitySql(listAlias: string, userIdSql: string): string {
  return `CASE
    WHEN ${listAlias}.purpose = 'group' THEN EXISTS (
      SELECT 1 FROM group_memberships membership
       WHERE membership.user_id = ${userIdSql}
         AND membership.group_id = ${listAlias}.group_id
         AND membership.left_at IS NULL
    )
    ELSE EXISTS (
      SELECT 1 FROM active_user_capacities capacity
       WHERE capacity.user_id = ${userIdSql}
         AND (
           ${listAlias}.auto_sync_categories_json IS NULL
           OR EXISTS (
             SELECT 1 FROM json_each(${listAlias}.auto_sync_categories_json)
              WHERE value = capacity.membership_category
           )
         )
    )
  END`;
}

export function mailingListDefaultSubscribedSql(listAlias: string, userIdSql: string): string {
  return `CASE ${listAlias}.subscription_default
    WHEN 'group_members' THEN EXISTS (
      SELECT 1 FROM group_memberships membership
       WHERE membership.user_id = ${userIdSql}
         AND membership.group_id = ${listAlias}.group_id
         AND membership.left_at IS NULL
    )
    WHEN 'eligible_categories' THEN EXISTS (
      SELECT 1 FROM active_user_capacities capacity
       WHERE capacity.user_id = ${userIdSql}
         AND (
           ${listAlias}.auto_sync_categories_json IS NULL
           OR EXISTS (
             SELECT 1 FROM json_each(${listAlias}.auto_sync_categories_json)
              WHERE value = capacity.membership_category
           )
         )
    )
    ELSE 0
  END`;
}

export const EFFECTIVE_SUBSCRIPTION_CTE = `${ACTIVE_USER_CAPACITIES_CTE},
  effective_subscriptions AS (
    SELECT list.id, list.email, list.label, list.purpose, list.group_id,
           list.is_primary_discussion, list.subscription_default,
           list.posting_policy, list.moderation_policy, list.auto_sync_categories_json,
           list.active, list.archived_at, list.created_at, list.updated_at,
           preference.preference,
           ${mailingListEligibilitySql("list", "input.user_id")} AS eligible,
           ${mailingListDefaultSubscribedSql("list", "input.user_id")} AS default_subscribed
      FROM mailing_lists list
      CROSS JOIN input
      LEFT JOIN mailing_list_subscription_preferences preference
        ON preference.mailing_list_id = list.id
       AND preference.user_id = input.user_id
     WHERE list.active = 1 AND list.archived_at IS NULL
  )`;

export const EFFECTIVE_SUBSCRIPTION_VALUE_SQL = `CASE
  WHEN eligible = 0 THEN 0
  WHEN preference = 'subscribed' THEN 1
  WHEN preference = 'unsubscribed' THEN 0
  ELSE default_subscribed
END`;
