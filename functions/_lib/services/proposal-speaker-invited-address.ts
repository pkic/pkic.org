/** A pending invitation belongs to the account only once its invited address is verified. */
export function speakerInvitedAddressOwnedSql(speaker: string): string {
  return `(${speaker}.status NOT IN ('invited', 'pending') OR ${speaker}.invited_email IS NULL OR EXISTS (
    SELECT 1 FROM users person WHERE person.id = ${speaker}.user_id AND (
      (person.normalized_email = ${speaker}.invited_email AND person.email_verified_at IS NOT NULL)
      OR EXISTS (SELECT 1 FROM user_emails address WHERE address.user_id = person.id
        AND address.normalized_email = ${speaker}.invited_email AND address.verified_at IS NOT NULL)
    )
  ))`;
}
