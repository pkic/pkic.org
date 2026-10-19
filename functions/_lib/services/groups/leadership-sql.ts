/**
 * The SQL fragments every leadership read shares. A leaf module: the people,
 * directory and seat reads join these without depending on the leadership
 * read model, which itself reaches the headshot and publication services.
 */
export const LEADERSHIP_ROLE_PREDICATE_SQL = `ur.role_id IN ('role-group_lead', 'role-group_deputy_lead')`;
export const ACTIVE_LEADERSHIP_PREDICATE_SQL = `ur.revoked_at IS NULL
  AND (ur.expires_at IS NULL OR ur.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

/**
 * The displayed title and term of one assignment. A row written before titles
 * existed falls back to its source group type's title for the role; the term
 * start falls back to the grant instant.
 */
export const LEADERSHIP_TERM_SELECT_SQL = `
  COALESCE(ur.title, CASE ur.role_id WHEN 'role-group_lead' THEN gt.lead_title ELSE gt.deputy_lead_title END) AS title,
  COALESCE(ur.starts_at, ur.created_at) AS starts_at,
  CASE WHEN ur.revoked_at IS NOT NULL THEN ur.revoked_at ELSE ur.expires_at END AS ends_at,
  CASE WHEN ${ACTIVE_LEADERSHIP_PREDICATE_SQL} THEN 1 ELSE 0 END AS active`;
