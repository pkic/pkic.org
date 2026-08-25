import { first } from "../../db/queries";
import type { DatabaseLike } from "../../types";

export async function hasActiveGroupMembership(db: DatabaseLike, userId: string, groupId: string): Promise<boolean> {
  return (
    (await first<{ authorized: number }>(
      db,
      `SELECT 1 AS authorized
         FROM group_memberships membership
         JOIN groups group_row ON group_row.id = membership.group_id AND group_row.active = 1
        WHERE membership.user_id = ? AND membership.group_id = ? AND membership.left_at IS NULL
        LIMIT 1`,
      [userId, groupId],
    )) !== null
  );
}
