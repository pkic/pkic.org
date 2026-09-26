import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike } from "../../types";
import { nowIso } from "../../utils/time";
import { prepareAuditLogWhen, prepareScopedAuditLog } from "../audit";
import { prepareReconcileMailingListSubscriptionsStatement } from "../mailing-list-subscriptions";
import { ACTIVE_USER_CAPACITIES_CTE } from "../membership/capacity-query";

export function prepareAutomaticGroupEnrollmentForUserStatements(
  db: DatabaseLike,
  userId: string,
  at: string,
): StatementLike[] {
  return [
    db
      .prepare(
        `${ACTIVE_USER_CAPACITIES_CTE}
         UPDATE group_memberships AS membership
            SET left_at = ?, updated_at = ?
          WHERE membership.user_id = ? AND membership.left_at IS NULL
            AND EXISTS (SELECT 1 FROM groups g WHERE g.id = membership.group_id)
            AND (
              NOT EXISTS (
                SELECT 1 FROM active_user_capacities capacity
                 WHERE capacity.member_id = membership.member_id
              )
              OR
              EXISTS (
                SELECT 1 FROM groups g
                JOIN group_automatic_enrollment_opt_outs opt_out
                  ON opt_out.group_id = g.id AND opt_out.user_id = membership.user_id
               WHERE g.id = membership.group_id AND g.allow_automatic_opt_out = 1
              )
              OR (
                membership.source = 'automatic_policy'
                AND NOT EXISTS (
                  SELECT 1
                    FROM groups g
                    JOIN group_membership_category_rules rule
                      ON rule.group_id = g.id
                     AND rule.permits_join = 1 AND rule.automatic_enrollment = 1
                    JOIN active_user_capacities capacity
                      ON capacity.member_id = membership.member_id
                     AND capacity.membership_category = rule.membership_category_code
                   WHERE g.id = membership.group_id
                     AND g.active = 1 AND g.automatic_enrollment_mode = 'category'
                )
              )
              OR (
                EXISTS (
                  SELECT 1 FROM groups g
                   WHERE g.id = membership.group_id AND g.eligibility_mode = 'category'
                )
                AND NOT EXISTS (
                  SELECT 1
                    FROM active_user_capacities capacity
                    JOIN group_membership_category_rules rule
                      ON rule.group_id = membership.group_id
                     AND rule.membership_category_code = capacity.membership_category
                     AND rule.permits_join = 1
                   WHERE capacity.member_id = membership.member_id
                )
              )
            )`,
      )
      .bind(userId, at, at, userId),
    prepareAuditLogWhen(db, {
      actorType: "system",
      actorId: null,
      action: "group_automatic_enrollment_ended",
      entityType: "user",
      entityId: userId,
      details: { userId },
      conditionSql: "SELECT 1 WHERE changes() > 0",
      conditionBindings: [],
      createdAt: at,
    }),
    db
      .prepare(
        `${ACTIVE_USER_CAPACITIES_CTE}
         INSERT OR IGNORE INTO group_memberships
           (id, group_id, user_id, identity_id, member_id, source, created_by_user_id,
            joined_at, left_at, created_at, updated_at)
         SELECT lower(hex(randomblob(16))), group_row.id, ?, capacity.identity_id, capacity.member_id,
                'automatic_policy', NULL, ?, NULL, ?, ?
           FROM active_user_capacities capacity
           JOIN group_membership_category_rules rule
             ON rule.membership_category_code = capacity.membership_category
            AND rule.permits_join = 1 AND rule.automatic_enrollment = 1
           JOIN groups group_row
             ON group_row.id = rule.group_id
            AND group_row.active = 1
            AND group_row.parent_group_id IS NULL
            AND group_row.automatic_enrollment_mode = 'category'
      LEFT JOIN group_automatic_enrollment_opt_outs opt_out
             ON opt_out.group_id = group_row.id AND opt_out.user_id = ?
          WHERE group_row.allow_automatic_opt_out = 0 OR opt_out.user_id IS NULL
          ORDER BY group_row.id, capacity.member_id`,
      )
      .bind(userId, userId, at, at, at, userId),
    prepareAuditLogWhen(db, {
      actorType: "system",
      actorId: null,
      action: "group_automatic_enrollment_added",
      entityType: "user",
      entityId: userId,
      details: { userId },
      conditionSql: "SELECT 1 WHERE changes() > 0",
      conditionBindings: [],
      createdAt: at,
    }),
    prepareReconcileMailingListSubscriptionsStatement(db, userId, at),
  ];
}

export async function reconcileAutomaticGroupEnrollmentForUser(db: DatabaseLike, userId: string): Promise<void> {
  if (!(await first(db, "SELECT id FROM users WHERE id = ? AND active = 1", [userId]))) {
    throw new AppError(404, "USER_NOT_FOUND", "Active user not found");
  }
  await db.batch(prepareAutomaticGroupEnrollmentForUserStatements(db, userId, nowIso()));
}

export async function setAutomaticEnrollmentOptOut(
  db: DatabaseLike,
  userId: string,
  groupIdOrSlug: string,
  optedOut: boolean,
): Promise<void> {
  const group = await first<{ id: string; automatic_enrollment_mode: string; allow_automatic_opt_out: number }>(
    db,
    `SELECT id, automatic_enrollment_mode, allow_automatic_opt_out
       FROM groups WHERE (id = ? OR slug = ?) AND active = 1`,
    [groupIdOrSlug, groupIdOrSlug],
  );
  if (!group) throw new AppError(404, "GROUP_NOT_FOUND", "Active group not found");
  if (group.automatic_enrollment_mode === "none") {
    throw new AppError(409, "GROUP_NOT_AUTOMATIC", "This group does not use automatic enrollment");
  }
  if (optedOut && group.allow_automatic_opt_out !== 1) {
    throw new AppError(409, "GROUP_OPT_OUT_DISABLED", "This group does not permit automatic-enrollment opt-out");
  }
  const at = nowIso();
  const preferenceStatement = optedOut
    ? db
        .prepare(
          `INSERT INTO group_automatic_enrollment_opt_outs
             (group_id, user_id, opted_out_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(group_id, user_id) DO UPDATE SET
             opted_out_at = excluded.opted_out_at, updated_at = excluded.updated_at`,
        )
        .bind(group.id, userId, at, at, at)
    : db
        .prepare("DELETE FROM group_automatic_enrollment_opt_outs WHERE group_id = ? AND user_id = ?")
        .bind(group.id, userId);
  await db.batch([
    preferenceStatement,
    prepareScopedAuditLog(
      db,
      { type: "group", id: group.id },
      "member",
      userId,
      optedOut ? "group_automatic_enrollment_opted_out" : "group_automatic_enrollment_reentered",
      "group",
      group.id,
      { userId },
      at,
    ),
    ...prepareAutomaticGroupEnrollmentForUserStatements(db, userId, at),
  ]);
}
