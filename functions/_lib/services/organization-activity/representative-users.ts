/**
 * The one definition of "this organization's people".
 *
 * Every activity read model on the account record is bounded by the same set:
 * the users behind the organization's ACTIVE identities — started, not ended,
 * not blocked. Stating it once as a named CTE keeps the three collections from
 * drifting into three slightly different ideas of who represents an
 * organization, and keeps the predicate on the
 * `idx_identities_organization_lifecycle` index.
 *
 * The fragment is a CTE body without its `WITH`, so a query that needs a
 * second CTE composes them in one `WITH` clause. It takes exactly one binding:
 * the organization id.
 */
export const ORGANIZATION_REPRESENTATIVE_USERS_CTE = `organization_representative_users AS (
    SELECT DISTINCT representative.user_id AS user_id
      FROM identities representative
     WHERE representative.organization_id = ?
       AND representative.started_at IS NOT NULL
       AND representative.ended_at IS NULL
       AND representative.blocked_at IS NULL
  )`;

/** The same lifecycle predicate, for a query that joins `identities` directly. */
export const ACTIVE_ORGANIZATION_IDENTITY_PREDICATE = `representative.organization_id = ?
     AND representative.started_at IS NOT NULL
     AND representative.ended_at IS NULL
     AND representative.blocked_at IS NULL`;
