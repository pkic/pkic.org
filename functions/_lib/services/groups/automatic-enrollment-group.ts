import type { DatabaseLike, StatementLike } from "../../types";
import { prepareAuditLogWhen } from "../audit";
import { prepareReconcileGroupMailingListSubscriptionsStatement } from "../mailing-list-subscriptions";
import { ALL_ACTIVE_USER_CAPACITIES_CTE } from "../membership/capacity-query";

/**
 * Set-based reconciliation after a group's eligibility or enrollment policy
 * changes. This intentionally performs no per-user read/write loop in D1.
 */
export function prepareAutomaticGroupEnrollmentForGroupStatements(
  db: DatabaseLike,
  groupId: string,
  at: string,
): StatementLike[] {
  return [
    db
      .prepare(
        `${ALL_ACTIVE_USER_CAPACITIES_CTE}
         UPDATE group_memberships AS membership
            SET left_at = ?, updated_at = ?
          WHERE membership.group_id = ? AND membership.left_at IS NULL
            AND (
              NOT EXISTS (
                SELECT 1 FROM active_user_capacities capacity
                 WHERE capacity.user_id = membership.user_id
                   AND capacity.member_id = membership.member_id
              )
              OR EXISTS (
                SELECT 1
                  FROM groups group_row
                  JOIN group_automatic_enrollment_opt_outs opt_out
                    ON opt_out.group_id = group_row.id
                   AND opt_out.user_id = membership.user_id
                 WHERE group_row.id = membership.group_id
                   AND group_row.allow_automatic_opt_out = 1
              )
              OR (
                EXISTS (
                  SELECT 1 FROM groups group_row
                   WHERE group_row.id = membership.group_id
                     AND group_row.eligibility_mode = 'category'
                )
                AND NOT EXISTS (
                  SELECT 1
                    FROM active_user_capacities capacity
                    JOIN group_membership_category_rules rule
                      ON rule.group_id = membership.group_id
                     AND rule.membership_category_code = capacity.membership_category
                     AND rule.permits_join = 1
                   WHERE capacity.user_id = membership.user_id
                     AND capacity.member_id = membership.member_id
                )
              )
              OR (
                membership.source = 'automatic_policy'
                AND NOT EXISTS (
                  SELECT 1
                    FROM groups group_row
                    JOIN active_user_capacities capacity
                      ON capacity.user_id = membership.user_id
                     AND capacity.member_id = membership.member_id
                    JOIN group_membership_category_rules rule
                      ON rule.group_id = group_row.id
                     AND rule.membership_category_code = capacity.membership_category
                     AND rule.permits_join = 1
                     AND rule.automatic_enrollment = 1
                   WHERE group_row.id = membership.group_id
                     AND group_row.active = 1
                     AND group_row.automatic_enrollment_mode = 'category'
                )
              )
            )`,
      )
      .bind(at, at, groupId),
    changedEnrollmentAudit(db, groupId, "group_automatic_enrollment_ended", at),
    db
      .prepare(
        `${ALL_ACTIVE_USER_CAPACITIES_CTE}
         INSERT OR IGNORE INTO group_memberships
           (id, group_id, user_id, member_id, source, created_by_user_id,
            joined_at, left_at, created_at, updated_at)
         SELECT lower(hex(randomblob(16))), group_row.id, capacity.user_id,
                capacity.member_id, 'automatic_policy', NULL, ?, NULL, ?, ?
           FROM groups group_row
           JOIN group_membership_category_rules rule ON rule.group_id = group_row.id
            AND rule.permits_join = 1 AND rule.automatic_enrollment = 1
           JOIN active_user_capacities capacity
             ON capacity.membership_category = rule.membership_category_code
      LEFT JOIN group_automatic_enrollment_opt_outs opt_out
             ON opt_out.group_id = group_row.id AND opt_out.user_id = capacity.user_id
          WHERE group_row.id = ? AND group_row.active = 1
            AND group_row.parent_group_id IS NULL
            AND group_row.automatic_enrollment_mode = 'category'
            AND (group_row.allow_automatic_opt_out = 0 OR opt_out.user_id IS NULL)
          ORDER BY capacity.user_id, capacity.member_id`,
      )
      .bind(at, at, at, groupId),
    changedEnrollmentAudit(db, groupId, "group_automatic_enrollment_added", at),
    prepareReconcileGroupMailingListSubscriptionsStatement(db, groupId, at),
  ];
}

function changedEnrollmentAudit(db: DatabaseLike, groupId: string, action: string, at: string): StatementLike {
  return prepareAuditLogWhen(db, {
    actorType: "system",
    actorId: null,
    action,
    entityType: "group",
    entityId: groupId,
    details: { groupId },
    conditionSql: "SELECT 1 WHERE changes() > 0",
    conditionBindings: [],
    createdAt: at,
    scope: { type: "group", id: groupId },
  });
}
