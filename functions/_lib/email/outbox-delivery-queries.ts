export const OUTBOX_ROW_COLUMNS = `id, event_id, template_key, template_version, recipient_user_id, recipient_email,
  subject, payload_json, message_type, provider, provider_message_id, status, attempts, send_after,
  last_error, created_at, updated_at, sent_at, processing_token, lease_expires_at`;

export function emailOutboxDueSql(excludeInFlight = false) {
  return `SELECT ${OUTBOX_ROW_COLUMNS}
    FROM email_outbox INDEXED BY idx_email_outbox_due
   WHERE status IN ('queued', 'retrying') AND send_after <= ?
     ${excludeInFlight ? "AND id NOT IN (SELECT value FROM json_each(?))" : ""}
  ORDER BY send_after, created_at, id
  LIMIT ?`;
}
export const EMAIL_OUTBOX_DUE_QUERY = emailOutboxDueSql();

export const EMAIL_OUTBOX_EXPIRED_LEASE_QUERY = `
  UPDATE email_outbox
     SET status = 'delivery_unknown', attempts = attempts + 1,
         last_error = 'SENDGRID_DELIVERY_UNKNOWN: Send interrupted before its delivery outcome was persisted',
         processing_token = NULL, lease_expires_at = NULL, updated_at = ?
   WHERE id IN (
     SELECT id
       FROM email_outbox INDEXED BY idx_email_outbox_expired_lease
      WHERE status = 'sending' AND lease_expires_at <= ?
      ORDER BY lease_expires_at, created_at, id
      LIMIT ?
   )
     AND status = 'sending' AND lease_expires_at <= ?`;
