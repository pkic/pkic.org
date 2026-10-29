import { sqlValue, type SqlId } from "../../db/sql-value";

/** Canonical current/successor observations used by identity creation and atomic composition. */
export function identityCreationSelections(userId: SqlId, organizationId: SqlId | null) {
  const user = sqlValue(userId),
    organization = sqlValue(organizationId);
  const scope = `user_id=${user.sql} AND organization_id IS ${organization.sql}`;
  const bindings = [...user.bindings, ...organization.bindings];
  return {
    unresolved: {
      sql: `SELECT id,started_at,blocked_at FROM identities WHERE ${scope} AND ended_at IS NULL
      ORDER BY invited_at DESC,id DESC LIMIT 1`,
      bindings,
    },
    latest: {
      sql: `SELECT id FROM identities WHERE ${scope} ORDER BY COALESCE(ended_at,invited_at) DESC,id DESC LIMIT 1`,
      bindings,
    },
  };
}
