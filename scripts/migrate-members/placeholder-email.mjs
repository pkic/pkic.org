/** Preserve the placeholder user's ID and every existing reference when assigning an approved address. */
import { sqlString } from "../lib/sql.mjs";

const eligiblePlaceholder = `u.pii_redacted_at IS NULL AND u.merged_into_user_id IS NULL
  AND u.active = 1 AND u.pending_email IS NULL
  AND EXISTS (SELECT 1 FROM members m WHERE m.user_id = u.id AND m.member_type = 'individual')
  AND EXISTS (SELECT 1 FROM identities i WHERE i.user_id = u.id AND i.organization_id IS NULL AND i.source = 'migration')`;

export function placeholderPreflightQuery(mappings) {
  if (!mappings.length) return null;
  return mappings
    .map(
      ({ previousEmail, email }) => `
SELECT ${sqlString(previousEmail)} AS placeholder, ${sqlString(email)} AS email,
  CASE WHEN NOT (${eligiblePlaceholder}) THEN 'placeholder is no longer an active migration account'
       ELSE 'confirmed email is already reserved; reconcile the accounts before importing' END AS reason
FROM users u WHERE u.normalized_email = ${sqlString(previousEmail)}
  AND (NOT (${eligiblePlaceholder}) OR EXISTS (
    SELECT 1 FROM users other WHERE other.id <> u.id
      AND (other.normalized_email = ${sqlString(email)} OR other.pending_email = ${sqlString(email)})
  ) OR EXISTS (
    SELECT 1 FROM user_emails alternate WHERE alternate.normalized_email = ${sqlString(email)}
  ))`,
    )
    .join("\nUNION ALL\n");
}

export function buildPlaceholderEmailStatement({ previousEmail, email }) {
  // Reservation triggers reject a competing claim, including an alternate or pending email.
  return `UPDATE users AS u SET email = ${sqlString(email)}, normalized_email = ${sqlString(email)},
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE u.normalized_email = ${sqlString(previousEmail)} AND ${eligiblePlaceholder};`;
}
