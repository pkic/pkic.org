import { first } from "../../db/queries";
import type { AuthorizationEvidence } from "../../db/authorization-guard";
import type { DatabaseLike } from "../../types";

export function activeGroupMembershipAuthorizationEvidence(userId: string, groupId: string): AuthorizationEvidence {
  return {
    sql: `SELECT 1
            FROM group_memberships membership
            JOIN groups group_row ON group_row.id = membership.group_id AND group_row.active = 1
           WHERE membership.user_id = ? AND membership.group_id = ? AND membership.left_at IS NULL
           LIMIT 1`,
    bindings: [userId, groupId],
  };
}

export async function hasActiveGroupMembership(db: DatabaseLike, userId: string, groupId: string): Promise<boolean> {
  const evidence = activeGroupMembershipAuthorizationEvidence(userId, groupId);
  return (
    (await first<{ authorized: number }>(db, `SELECT 1 AS authorized WHERE EXISTS (${evidence.sql})`, [
      ...evidence.bindings,
    ])) !== null
  );
}
