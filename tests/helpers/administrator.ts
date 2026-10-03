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
