/**
 * Canonical registration-recipient projection for SQL queries that alias
 * registrations as `r` and users as `u`.
 *
 * A pending account address belongs to one registration confirmation flow;
 * every other registration for the same user continues to use the primary.
 */
export const REGISTRATION_RECIPIENT_EMAIL_SQL = `CASE
  WHEN u.pending_email_change_registration_id = r.id
    THEN COALESCE(u.pending_email, u.email)
  ELSE u.email
END`;
