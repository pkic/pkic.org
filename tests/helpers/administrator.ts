import type { DatabaseLike } from "../../functions/_lib/types";
import { computeGrantsForUser } from "../../functions/_lib/auth/permissions";

/** Give a fixture the same revocable administrator assignment as access control. */
export async function grantAdministrator(db: DatabaseLike, userId: string) {
  await db
    .prepare(
      `INSERT INTO user_roles (id, user_id, role_id, context_type, context_id, created_at)
     VALUES (?, ?, 'role-admin', NULL, NULL, ?)
     ON CONFLICT DO NOTHING`,
    )
    .bind(crypto.randomUUID(), userId, new Date().toISOString())
    .run();
  return computeGrantsForUser(db, userId);
}

export { administratorGrants } from "./administrator-grants";

/** Select a seeded, active administrator through its live global assignment. */
export const ADMINISTRATOR_FIXTURE_USER_SQL = `SELECT u.id, u.email FROM users u
  WHERE u.active = 1 AND EXISTS (
    SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role_id = 'role-admin'
      AND ur.context_type IS NULL AND ur.context_id IS NULL AND ur.revoked_at IS NULL
      AND (ur.expires_at IS NULL OR ur.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  ) ORDER BY u.id LIMIT 1`;
