import { buildD1TextSearchFilter, type D1TextSearchFilter } from "../db/search";

/** Canonical primary/alias email, name, and organization search for user read models. */
export function buildUserIdentitySearchFilter(query: string): D1TextSearchFilter {
  const primary = buildD1TextSearchFilter(query, [
    "u.email",
    "u.first_name",
    "u.last_name",
    "u.first_name || ' ' || u.last_name",
    "u.organization_name",
  ]);
  const alternate = buildD1TextSearchFilter(query, ["catalog_email.email"]);
  return {
    sql: `(${primary.sql} OR EXISTS (
      SELECT 1
        FROM user_emails catalog_email
       WHERE catalog_email.user_id = u.id
         AND ${alternate.sql}
    ))`,
    bindings: [...primary.bindings, ...alternate.bindings],
  };
}
