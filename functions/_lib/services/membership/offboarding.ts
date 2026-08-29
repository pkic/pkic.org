import type { DatabaseLike, StatementLike } from "../../types";
import { prepareReconcileMailingListSubscriptionsStatement } from "../mailing-list-subscriptions";

/** Commit-order-safe user offboarding: no seat/list pre-read can become stale before the batch commits. */
export async function buildUserAccessOffboardingStatements(
  db: DatabaseLike,
  input: { userId: string; causeKey: string; at: string },
): Promise<StatementLike[]> {
  return [
    db
      .prepare(
        `UPDATE group_memberships
            SET left_at = CASE WHEN joined_at > ? THEN joined_at ELSE ? END,
                updated_at = CASE WHEN joined_at > ? THEN joined_at ELSE ? END
          WHERE user_id = ? AND left_at IS NULL`,
      )
      .bind(input.at, input.at, input.at, input.at, input.userId),
    db
      .prepare(
        `UPDATE organization_representatives
            SET left_at = CASE WHEN joined_at > ? THEN joined_at ELSE ? END,
                updated_at = CASE WHEN joined_at > ? THEN joined_at ELSE ? END
          WHERE user_id = ? AND left_at IS NULL`,
      )
      .bind(input.at, input.at, input.at, input.at, input.userId),
    prepareReconcileMailingListSubscriptionsStatement(db, input.userId, input.at),
  ];
}

/** Closes only access justified by one membership, evaluated inside the committing batch. */
export async function buildMembershipAccessOffboardingStatements(
  db: DatabaseLike,
  input: { userId: string; memberId: string; causeKey: string; at: string },
): Promise<StatementLike[]> {
  return [
    db
      .prepare(
        `UPDATE group_memberships
            SET left_at = CASE WHEN joined_at > ? THEN joined_at ELSE ? END,
                updated_at = CASE WHEN joined_at > ? THEN joined_at ELSE ? END
          WHERE user_id = ? AND member_id = ? AND left_at IS NULL`,
      )
      .bind(input.at, input.at, input.at, input.at, input.userId, input.memberId),
    prepareReconcileMailingListSubscriptionsStatement(db, input.userId, input.at),
  ];
}
