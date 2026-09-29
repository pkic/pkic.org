import { buildD1TextSearchFilter, type D1TextSearchFilter } from "../db/search";

/** Canonical primary/alias email, name, and active-identity search for user read models. */
export function buildUserIdentitySearchFilter(query: string): D1TextSearchFilter {
  const primary = buildD1TextSearchFilter(query, [
    "u.email",
    "u.first_name",
    "u.last_name",
    "u.first_name || ' ' || u.last_name",
  ]);
  const alternate = buildD1TextSearchFilter(query, ["catalog_email.email"]);
  const identity = buildD1TextSearchFilter(query, ["identity_organization.name", "search_identity.job_title"]);
  return {
    sql: `(${primary.sql} OR EXISTS (
      SELECT 1
        FROM user_emails catalog_email
       WHERE catalog_email.user_id = u.id
         AND ${alternate.sql}
    ) OR EXISTS (
      SELECT 1
        FROM identities search_identity
   LEFT JOIN organizations identity_organization ON identity_organization.id = search_identity.organization_id
       WHERE search_identity.user_id = u.id
         AND search_identity.started_at IS NOT NULL
         AND search_identity.ended_at IS NULL
         AND search_identity.blocked_at IS NULL
         AND ${identity.sql}
    ))`,
    bindings: [...primary.bindings, ...alternate.bindings, ...identity.bindings],
  };
}
