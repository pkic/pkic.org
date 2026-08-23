/**
 * Canonical registration-recipient projection for SQL queries that alias
 * registrations as `r` and users as `u`.
 *
 * A pending account address belongs to one registration confirmation flow.
 * It becomes a recipient only after the current login address has explicitly
 * authorized the account-level change. Every other registration, and the
 * authorization stage itself, continue to use the primary address.
 */
export const REGISTRATION_RECIPIENT_EMAIL_SQL = `CASE
  WHEN u.pending_email_change_registration_id = r.id
    AND u.pending_email_current_confirmed_at IS NOT NULL
    THEN COALESCE(u.pending_email, u.email)
  ELSE u.email
END`;
