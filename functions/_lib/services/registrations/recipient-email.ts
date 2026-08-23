/**
 * Canonical registration-recipient projection for SQL queries that alias
 * registrations as `r` and users as `u`.
 *
 * Ordinary notifications always use the verified canonical address. A
 * pending account address is untrusted and may receive only messages whose
 * sole purpose is proving control of that exact address.
 */
export const REGISTRATION_RECIPIENT_EMAIL_SQL = "u.email";

/** Recipient projection exclusively for confirmation emails and views. */
export const REGISTRATION_CONFIRMATION_RECIPIENT_EMAIL_SQL = `CASE
  WHEN u.pending_email_change_registration_id = r.id
    THEN COALESCE(u.pending_email, u.email)
  ELSE u.email
END`;
