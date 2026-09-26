/** Preserve the placeholder user's ID and every existing reference when assigning an approved address. */
import { sqlString } from "../lib/sql.mjs";

const eligiblePlaceholder = `u.pii_redacted_at IS NULL AND u.merged_into_user_id IS NULL
  AND u.active = 1 AND u.pending_email IS NULL
  AND EXISTS (SELECT 1 FROM members m WHERE m.user_id = u.id AND m.member_type = 'individual')
  AND EXISTS (SELECT 1 FROM identities i WHERE i.user_id = u.id AND i.organization_id IS NULL AND i.source = 'migration')`;

export function placeholderPreflightQuery(mappings) {
  if (!mappings.length) return null;
  const values = mappings.map(({ previousEmail, email }) => `(${sqlString(previousEmail)}, ${sqlString(email)})`);
  return `WITH mappings(placeholder, email) AS (VALUES ${values.join(",\n")})
SELECT mappings.placeholder, mappings.email,
  CASE WHEN NOT (${eligiblePlaceholder}) THEN 'placeholder is no longer an active migration account'
       ELSE 'confirmed email is already reserved; reconcile the accounts before importing' END AS reason
FROM mappings JOIN users u ON u.normalized_email = mappings.placeholder
  WHERE NOT (${eligiblePlaceholder}) OR EXISTS (
    SELECT 1 FROM users other WHERE other.id <> u.id
      AND (other.normalized_email = mappings.email OR other.pending_email = mappings.email)
  ) OR EXISTS (
    SELECT 1 FROM user_emails alternate WHERE alternate.normalized_email = mappings.email
  )`;
}

export function buildPlaceholderEmailStatement({ previousEmail, email }) {
  // Reservation triggers reject a competing claim, including an alternate or pending email.
  return `UPDATE users AS u SET email = ${sqlString(email)}, normalized_email = ${sqlString(email)},
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE u.normalized_email = ${sqlString(previousEmail)} AND ${eligiblePlaceholder};`;
}
