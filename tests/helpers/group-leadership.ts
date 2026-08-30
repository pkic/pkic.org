import { buildCreateIndividualMemberStatements } from "../../functions/_lib/services/membership/memberships";
import type { DatabaseLike } from "../../functions/_lib/types";
import { first } from "../../functions/_lib/db/queries";

/** Seeds one real, active Member capacity for group-leadership integration fixtures. */
export async function ensureGroupMembershipCapacity(
  db: DatabaseLike,
  groupId: string,
  userId: string,
): Promise<string> {
  const parent = await first<{ parent_group_id: string | null }>(
    db,
    "SELECT parent_group_id FROM groups WHERE id = ?",
    [groupId],
  );
  let row = await first<{ member_id: string }>(
    db,
    `SELECT member.id AS member_id
       FROM members member
       LEFT JOIN organization_representatives representative
         ON representative.member_id = member.id
        AND representative.user_id = ?
        AND representative.left_at IS NULL
        AND representative.blocked_at IS NULL
      WHERE member.status = 'active'
        AND (member.user_id = ? OR representative.user_id IS NOT NULL)
      ORDER BY CASE WHEN member.user_id = ? THEN 0 ELSE 1 END, member.created_at, member.id
      LIMIT 1`,
    [userId, userId, userId],
  );
  if (!row) {
    const created = buildCreateIndividualMemberStatements(db, userId, "H5", new Date().toISOString());
    await db.batch(created.statements);
    row = { member_id: created.memberId };
  }

  if (parent?.parent_group_id) {
    await ensureGroupMembershipCapacity(db, parent.parent_group_id, userId);
  }

  const existing = await first<{ id: string }>(
    db,
    `SELECT id FROM group_memberships WHERE group_id = ? AND user_id = ? AND member_id = ? ORDER BY joined_at DESC LIMIT 1`,
    [groupId, userId, row.member_id],
  );
  if (existing) {
    await db
      .prepare("UPDATE group_memberships SET left_at = NULL, updated_at = datetime('now') WHERE id = ?")
      .bind(existing.id)
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO group_memberships
           (id, group_id, user_id, member_id, source, joined_at, left_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'staff', datetime('now'), NULL, datetime('now'), datetime('now'))`,
      )
      .bind(crypto.randomUUID(), groupId, userId, row.member_id)
      .run();
  }
  return row.member_id;
}
