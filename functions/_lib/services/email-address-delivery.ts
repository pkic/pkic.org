import {
  emailAddressDeliverySchema,
  UNKNOWN_EMAIL_DELIVERY,
  type EmailAddressDelivery,
} from "../../../assets/shared/schemas/email-address-delivery";
import { parseJsonSafe } from "../utils/json";

const DELIVERY_ACTIONS =
  "'email_hard_bounce','email_soft_bounce','email_deferred','email_dropped','email_spam_report','email_delivered'";

/** Internal SQL expressions only. Uses indexed address history, never another user's address evidence. */
export function emailAddressDeliveryJsonSql(userId: string, email: string): string {
  const recipient = `delivery.recipient_email = ${email} COLLATE NOCASE
    AND (delivery.recipient_user_id = ${userId} OR delivery.recipient_user_id IS NULL)`;
  return `(WITH address_messages AS MATERIALIZED (
    SELECT delivery.id, delivery.recipient_email, delivery.status, delivery.updated_at, delivery.last_error
    FROM email_outbox delivery WHERE ${recipient}
  ) SELECT json_object('status',
      CASE WHEN bouncing_at IS NOT NULL AND (delivered_at IS NULL OR bouncing_at >= delivered_at) THEN 'bouncing'
           WHEN blocked_at IS NOT NULL AND (delivered_at IS NULL OR blocked_at >= delivered_at) THEN 'blocked'
           WHEN delayed_at IS NOT NULL AND (delivered_at IS NULL OR delayed_at >= delivered_at) THEN 'delayed'
           WHEN delivered_at IS NOT NULL THEN 'delivered' ELSE 'unknown' END,
      'observedAt',
      CASE WHEN bouncing_at IS NOT NULL AND (delivered_at IS NULL OR bouncing_at >= delivered_at) THEN bouncing_at
           WHEN blocked_at IS NOT NULL AND (delivered_at IS NULL OR blocked_at >= delivered_at) THEN blocked_at
           WHEN delayed_at IS NOT NULL AND (delivered_at IS NULL OR delayed_at >= delivered_at) THEN delayed_at
           ELSE delivered_at END)
    FROM (
      SELECT MAX(CASE WHEN signal='bouncing' THEN observed_at END) AS bouncing_at,
             MAX(CASE WHEN signal='blocked' THEN observed_at END) AS blocked_at,
             MAX(CASE WHEN signal='delayed' THEN observed_at END) AS delayed_at,
             MAX(CASE WHEN signal='delivered' THEN observed_at END) AS delivered_at
      FROM (
        SELECT CASE
          WHEN evidence.action='email_hard_bounce' THEN 'bouncing'
          WHEN evidence.action IN ('email_soft_bounce','email_deferred') THEN 'delayed'
          WHEN evidence.action='email_delivered' THEN 'delivered'
          WHEN evidence.action='email_dropped' AND lower(json_extract(evidence.details_json,'$.reason')) LIKE '%bounced address%' THEN 'bouncing'
          ELSE 'blocked' END AS signal,
          strftime('%Y-%m-%dT%H:%M:%fZ',evidence.created_at) AS observed_at
        FROM address_messages delivery CROSS JOIN audit_log evidence
          ON evidence.entity_type='email_outbox' AND evidence.entity_id=delivery.id
        WHERE evidence.action IN (${DELIVERY_ACTIONS})
          AND (json_extract(evidence.details_json,'$.email') IS NULL
            OR json_extract(evidence.details_json,'$.email') = delivery.recipient_email COLLATE NOCASE)
        UNION ALL
        SELECT CASE WHEN delivery.status='delivered' THEN 'delivered'
          WHEN delivery.last_error LIKE 'Spam report%'
            OR (delivery.last_error LIKE 'Dropped:%' AND delivery.last_error NOT LIKE '%Bounced Address%') THEN 'blocked'
          ELSE 'bouncing' END,
          strftime('%Y-%m-%dT%H:%M:%fZ',delivery.updated_at)
        FROM address_messages delivery
        WHERE delivery.status IN ('bounced','delivered')
          AND NOT EXISTS (SELECT 1 FROM audit_log evidence
            WHERE evidence.entity_type='email_outbox' AND evidence.entity_id=delivery.id
              AND evidence.action IN (${DELIVERY_ACTIONS})
              AND (delivery.status='bounced' OR json_extract(evidence.details_json,'$.email') IS NULL
                OR json_extract(evidence.details_json,'$.email') = delivery.recipient_email COLLATE NOCASE))
      ) signals
    ) history)`;
}

export function decodeEmailAddressDelivery(json: string | null | undefined): EmailAddressDelivery {
  return emailAddressDeliverySchema.parse(parseJsonSafe<unknown>(json ?? "", UNKNOWN_EMAIL_DELIVERY));
}
