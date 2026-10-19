import type { DatabaseLike, StatementLike } from "../../types";
import { prepareAuditLogWhen } from "../audit";
import { prepareReconcileGroupMailingListSubscriptionsStatement } from "../mailing-list-subscriptions";
import { automaticEnrollmentRemovalSelection, automaticEnrollmentAdditionSelection } from "./automatic-enrollment-sql";
import {
  prepareAutomaticEnrollmentWithdrawalPublication,
  prepareAutomaticEnrollmentAdditionPublication,
} from "./automatic-enrollment-publication";

/**
 * Set-based reconciliation after a group's eligibility or enrollment policy
 * changes. This intentionally performs no per-user read/write loop in D1.
 */
export function prepareAutomaticGroupEnrollmentForGroupStatements(
  db: DatabaseLike,
  groupId: string,
  at: string,
): StatementLike[] {
  const scope = { type: "group" as const, id: groupId };
  const removal = automaticEnrollmentRemovalSelection(scope);
  const addition = automaticEnrollmentAdditionSelection(scope);
  return [
    prepareAutomaticEnrollmentWithdrawalPublication(db, scope, at, removal),
    db
      .prepare(`UPDATE group_memberships SET left_at=?,updated_at=?
      WHERE left_at IS NULL AND id IN (${removal.sql})`)
      .bind(at, at, ...removal.bindings),
    changedEnrollmentAudit(db, groupId, "group_automatic_enrollment_ended", at),
    prepareAutomaticEnrollmentAdditionPublication(db, scope, at, addition),
    db
      .prepare(`INSERT OR IGNORE INTO group_memberships
      (id,group_id,user_id,identity_id,member_id,source,created_by_user_id,joined_at,left_at,created_at,updated_at)
      SELECT lower(hex(randomblob(16))),candidate.group_id,candidate.user_id,candidate.identity_id,candidate.member_id,
        'automatic_policy',NULL,?,NULL,?,? FROM (${addition.sql}) candidate`)
      .bind(at, at, at, ...addition.bindings),
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
