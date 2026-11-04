/** One delivery projection for claimed work and stale-effect reconciliation. Expressions are caller-owned SQL. */
export function googleGroupsDeliverySql(action: string, userId: string, groupEmail: string): string {
  return `CASE WHEN ${action} = 'remove_from_list' THEN NULL
    WHEN ${action} = 'restore_delivery' THEN 'all'
    ELSE (SELECT CASE preference.preference WHEN 'subscribed' THEN 'all' WHEN 'archive_only' THEN 'none' ELSE NULL END
      FROM mailing_lists list LEFT JOIN mailing_list_subscription_preferences preference
        ON preference.mailing_list_id = list.id AND preference.user_id = ${userId}
      WHERE list.email = ${groupEmail}) END`;
}
