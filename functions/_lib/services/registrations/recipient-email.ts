/**
 * Canonical registration-recipient projections for SQL queries that alias
 * registrations as `r` and users as `u`.
 *
 * A registration speaks for the identity it was made as, so its ordinary
 * messages go to that identity's verified address, else to the account's
 * verified canonical address. A pending account address is untrusted and may
 * receive only messages whose sole purpose is proving control of that exact
 * address.
 */

/** The verified address an identity uses, or NULL when it uses the account's address. */
function identityVerifiedEmailSql(identityIdSql: string): string {
  return `(SELECT recipient_address.email FROM identities recipient_identity
    JOIN user_emails recipient_address ON recipient_address.id = recipient_identity.email_id
     AND recipient_address.user_id = recipient_identity.user_id AND recipient_address.verified_at IS NOT NULL
    WHERE recipient_identity.id = ${identityIdSql} AND recipient_identity.user_id = u.id)`;
}

/** Where a registration made as `identityIdSql` sends its ordinary messages. */
export function registrationRecipientEmailSql(identityIdSql = "r.registration_identity_id"): string {
  return `COALESCE(${identityVerifiedEmailSql(identityIdSql)}, u.email)`;
}

export const REGISTRATION_RECIPIENT_EMAIL_SQL = registrationRecipientEmailSql();

/**
 * Recipient projection exclusively for confirmation emails and views.
 * Confirming verifies the account's address, so the proof goes only there.
 */
export const REGISTRATION_CONFIRMATION_RECIPIENT_EMAIL_SQL = `CASE
  WHEN u.pending_email_change_registration_id = r.id
    THEN COALESCE(u.pending_email, u.email)
  ELSE u.email
END`;

/** The address a registration's next message goes to: the confirmation address until it is confirmed. */
export const REGISTRATION_CURRENT_RECIPIENT_EMAIL_SQL = `CASE
  WHEN r.status = 'pending_email_confirmation' THEN ${REGISTRATION_CONFIRMATION_RECIPIENT_EMAIL_SQL}
  ELSE ${REGISTRATION_RECIPIENT_EMAIL_SQL}
END`;

/** Pending mailboxes may receive proof only; manage capabilities stay on the account address. */
export const REGISTRATION_RECOVERY_RECIPIENT_EMAIL_SQL = `CASE
  WHEN r.status = 'pending_email_confirmation' THEN u.email
  ELSE ${REGISTRATION_RECIPIENT_EMAIL_SQL}
END`;
