import { all } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { ALL_ACTIVE_USER_CAPACITIES_CTE } from "../membership/capacity-query";
import { mailingListEligibilitySql, mailingListDefaultSubscribedSql } from "./projection";

export interface MailingListDeliveryAddress {
  userId: string;
  email: string;
  primaryEmail: string;
  noDelivery: number;
  confirmedSubscribed: number;
}

/** Current primary and verified-alias delivery addresses, using the canonical subscription policy. */
export async function listMailingListDeliveryAddresses(db: DatabaseLike, listEmail: string) {
  const rows = await all<MailingListDeliveryAddress>(
    db,
    `${ALL_ACTIVE_USER_CAPACITIES_CTE},
    eligible_subscribers AS (
      SELECT person.id, lower(person.email) AS email,
        EXISTS (SELECT 1 FROM google_groups_observed_membership observed
          WHERE observed.user_id = person.id AND observed.google_group_email = list.email
            AND observed.confirmed_subscribed_at IS NOT NULL) AS confirmedSubscribed
      FROM users person JOIN mailing_lists list ON list.email = ?
      LEFT JOIN mailing_list_subscription_preferences preference
        ON preference.mailing_list_id = list.id AND preference.user_id = person.id
      WHERE person.active = 1 AND person.pii_redacted_at IS NULL AND person.merged_into_user_id IS NULL
        AND list.active = 1 AND list.archived_at IS NULL
        AND ${mailingListEligibilitySql("list", "person.id")}
        AND CASE WHEN preference.preference = 'subscribed' THEN 1
                 WHEN preference.preference = 'unsubscribed' THEN 0
                 ELSE ${mailingListDefaultSubscribedSql("list", "person.id")} END = 1
        AND NOT EXISTS (SELECT 1 FROM google_groups_observed_membership observed
          WHERE observed.user_id = person.id AND observed.google_group_email = list.email AND observed.suppressed = 1)
    ), expected_addresses AS (
      SELECT id AS userId, email, email AS primaryEmail, 0 AS noDelivery, confirmedSubscribed FROM eligible_subscribers
      UNION ALL
      SELECT subscriber.id, lower(address.email), subscriber.email, 1, subscriber.confirmedSubscribed FROM user_emails address
        JOIN eligible_subscribers subscriber ON subscriber.id = address.user_id
        WHERE address.verified_at IS NOT NULL
    ) SELECT userId, email, primaryEmail, noDelivery, confirmedSubscribed FROM expected_addresses ORDER BY email LIMIT 5001`,
    [listEmail],
  );
  // Never delete from an incomplete desired roster.
  if (rows.length > 5000) throw new Error("Desired roster exceeds reconciliation limit; no changes planned");
  return rows;
}
