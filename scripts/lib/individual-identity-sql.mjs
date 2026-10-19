/**
 * Every person holds an identity. A seeded or imported account that holds no
 * active identity receives an active individual one; an account that already
 * holds any active identity (an organization one included) is left alone, so
 * emit this after the statements that create organization identities.
 *
 * @param {string} userIdSql trusted SQL expression selecting the user's id
 * @param {"migration" | "staff"} source
 */
export function individualIdentityFallbackSql(userIdSql, source) {
  if (source !== "migration" && source !== "staff") throw new Error(`Unsupported identity source: ${source}`);
  return `
INSERT INTO identities
  (id, user_id, organization_id, email_id, job_title, biography, links_json,
   source, show_on_organization_profile, invited_at, started_at, created_at, updated_at)
SELECT lower(hex(randomblob(16))), u.id, NULL, NULL, NULL, NULL, NULL,
       '${source}', 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM users u
 WHERE u.id = ${userIdSql}
   AND NOT EXISTS (
     SELECT 1 FROM identities held
      WHERE held.user_id = u.id
        AND held.started_at IS NOT NULL AND held.ended_at IS NULL AND held.blocked_at IS NULL);
`;
}
