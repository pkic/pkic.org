import { buildCreateIndividualMemberStatements } from "../../functions/_lib/services/membership/memberships";
import { buildCreateIdentityStatement } from "../../functions/_lib/services/membership/identities";
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
  let row = await first<{ member_id: string; identity_id: string }>(
    db,
    `SELECT capacity.member_id, capacity.identity_id
       FROM identity_member_capacities capacity
       JOIN identities identity ON identity.id = capacity.identity_id
       JOIN members member ON member.id = capacity.member_id
      WHERE member.status = 'active'
        AND capacity.user_id = ?
        AND identity.started_at IS NOT NULL
        AND identity.ended_at IS NULL
        AND identity.blocked_at IS NULL
      ORDER BY CASE WHEN member.user_id = ? THEN 0 ELSE 1 END, member.created_at, member.id
      LIMIT 1`,
    [userId, userId],
  );
  if (!row) {
    const created = buildCreateIndividualMemberStatements(db, userId, "H5", new Date().toISOString());
    const identity = await buildCreateIdentityStatement(db, {
      userId,
      organizationId: null,
      source: "staff",
      startImmediately: true,
    });
    await db.batch([...created.statements, identity.statement]);
    row = { member_id: created.memberId, identity_id: identity.identityId };
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
           (id, group_id, user_id, identity_id, member_id, source, joined_at, left_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'staff', datetime('now'), NULL, datetime('now'), datetime('now'))`,
      )
      .bind(crypto.randomUUID(), groupId, userId, row.identity_id, row.member_id)
      .run();
  }
  return row.member_id;
}

/** Seeds a capacity-bound group leadership assignment and returns both row ids. */
export async function activeIdentityIdForMember(db: DatabaseLike, userId: string, memberId: string): Promise<string> {
  const identity = await first<{ identity_id: string }>(
    db,
    `SELECT capacity.identity_id
       FROM identity_member_capacities capacity
       JOIN identities identity ON identity.id = capacity.identity_id
      WHERE capacity.user_id = ? AND capacity.member_id = ?
        AND identity.started_at IS NOT NULL AND identity.ended_at IS NULL AND identity.blocked_at IS NULL`,
    [userId, memberId],
  );
  if (!identity) throw new Error("Active identity required for Member capacity");
  return identity.identity_id;
}

export async function grantGroupLeadershipCapacity(
  db: DatabaseLike,
  groupId: string,
  userId: string,
  options: {
    roleId?: "role-group_lead" | "role-group_deputy_lead";
    grantedByUserId?: string | null;
    roleAssignmentId?: string;
  } = {},
): Promise<{ roleAssignmentId: string; memberId: string; identityId: string }> {
  const memberId = await ensureGroupMembershipCapacity(db, groupId, userId);
  const identityId = await activeIdentityIdForMember(db, userId, memberId);
  const roleAssignmentId = options.roleAssignmentId ?? crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO user_roles
         (id, user_id, member_id, identity_id, role_id, context_type, context_id, single_holder_per_context,
          granted_by_user_id, created_at)
       VALUES (?, ?, ?, ?, ?, 'group', ?, 0, ?, datetime('now'))`,
    )
    .bind(
      roleAssignmentId,
      userId,
      memberId,
      identityId,
      options.roleId ?? "role-group_lead",
      groupId,
      options.grantedByUserId ?? null,
    )
    .run();
  return { roleAssignmentId, memberId, identityId };
}
