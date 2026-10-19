import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike } from "../../types";
import { nowIso } from "../../utils/time";
import { prepareAuditLogWhen, prepareScopedAuditLog } from "../audit";
import { prepareReconcileMailingListSubscriptionsStatement } from "../mailing-list-subscriptions";
import { automaticEnrollmentRemovalSelection, automaticEnrollmentAdditionSelection } from "./automatic-enrollment-sql";
import {
  prepareAutomaticEnrollmentWithdrawalPublication,
  prepareAutomaticEnrollmentAdditionPublication,
} from "./automatic-enrollment-publication";

export function prepareAutomaticGroupEnrollmentForUserStatements(
  db: DatabaseLike,
  userId: string,
  at: string,
  leftAt = at,
): StatementLike[] {
  const scope = { type: "user" as const, id: userId };
  const removal = automaticEnrollmentRemovalSelection(scope);
  const addition = automaticEnrollmentAdditionSelection(scope);
  return [
    prepareAutomaticEnrollmentWithdrawalPublication(db, scope, at, removal),
    db
      .prepare(`UPDATE group_memberships SET left_at=MAX(joined_at,?),updated_at=?
      WHERE left_at IS NULL AND id IN (${removal.sql})`)
      .bind(leftAt, at, ...removal.bindings),
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
    prepareAutomaticEnrollmentAdditionPublication(db, scope, at, addition),
    db
      .prepare(`INSERT OR IGNORE INTO group_memberships
      (id,group_id,user_id,identity_id,member_id,source,created_by_user_id,joined_at,left_at,created_at,updated_at)
      SELECT lower(hex(randomblob(16))),candidate.group_id,candidate.user_id,candidate.identity_id,candidate.member_id,
        'automatic_policy',NULL,?,NULL,?,? FROM (${addition.sql}) candidate`)
      .bind(at, at, at, ...addition.bindings),
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
