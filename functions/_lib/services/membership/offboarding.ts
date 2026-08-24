import type { DatabaseLike, StatementLike } from "../../types";

function enqueueUserRemovals(db: DatabaseLike, input: { userId: string; causeKey: string; at: string }): StatementLike {
  return db
    .prepare(
      `INSERT OR IGNORE INTO google_groups_sync_queue
         (id, user_id, action, google_group_email, idempotency_key, status, attempts, last_error,
          next_attempt_at, created_at, processed_at)
       SELECT 'google-sync:' || lower(hex(randomblob(16))), ?, 'remove_from_list', email,
              ? || ':google-group:' || email, 'pending', 0, NULL, ?, ?, NULL
         FROM (
           SELECT email FROM mailing_lists WHERE active = 1
           UNION
           SELECT wg.mailing_list_email AS email
             FROM working_group_members wgm
             JOIN working_groups wg ON wg.id = wgm.working_group_id
            WHERE wgm.user_id = ? AND wgm.left_at IS NULL AND wg.mailing_list_email IS NOT NULL
         ) managed_emails
        ORDER BY email`,
    )
    .bind(input.userId, input.causeKey, input.at, input.at, input.userId);
}

/** Commit-order-safe user offboarding: no seat/list pre-read can become stale before the batch commits. */
export async function buildUserAccessOffboardingStatements(
  db: DatabaseLike,
  input: { userId: string; causeKey: string; at: string },
): Promise<StatementLike[]> {
  return [
    enqueueUserRemovals(db, input),
    db
      .prepare("UPDATE working_group_members SET left_at = ? WHERE user_id = ? AND left_at IS NULL")
      .bind(input.at, input.userId),
    db
      .prepare("UPDATE group_memberships SET left_at = ?, updated_at = ? WHERE user_id = ? AND left_at IS NULL")
      .bind(input.at, input.at, input.userId),
    db
      .prepare(
        `UPDATE organization_representatives
            SET left_at = ?, updated_at = ?
          WHERE user_id = ? AND left_at IS NULL`,
      )
      .bind(input.at, input.at, input.userId),
  ];
}

function enqueueMembershipRemovals(
  db: DatabaseLike,
  input: { userId: string; memberId: string; causeKey: string; at: string },
): StatementLike {
  return db
    .prepare(
      `INSERT OR IGNORE INTO google_groups_sync_queue
         (id, user_id, action, google_group_email, idempotency_key, status, attempts, last_error,
          next_attempt_at, created_at, processed_at)
       SELECT 'google-sync:' || lower(hex(randomblob(16))), ?, 'remove_from_list', email,
              ? || ':google-group:' || email, 'pending', 0, NULL, ?, ?, NULL
         FROM (
           SELECT wg.mailing_list_email AS email
             FROM working_group_members wgm
             JOIN working_groups wg ON wg.id = wgm.working_group_id
            WHERE wgm.user_id = ? AND wgm.left_at IS NULL
              AND wg.mailing_list_email IS NOT NULL
              AND (
                wgm.member_id = ?
                OR (
                  wgm.member_id IS NULL
                  AND NOT EXISTS (
                    SELECT 1
                      FROM members remaining_member
                      LEFT JOIN organization_representatives remaining_rep
                        ON remaining_rep.member_id = remaining_member.id
                       AND remaining_rep.user_id = ? AND remaining_rep.left_at IS NULL
                     WHERE remaining_member.id != ? AND remaining_member.status = 'active'
                       AND (remaining_member.user_id = ? OR remaining_rep.id IS NOT NULL)
                  )
                )
              )
         ) removal_emails
        ORDER BY email`,
    )
    .bind(
      input.userId,
      input.causeKey,
      input.at,
      input.at,
      input.userId,
      input.memberId,
      input.userId,
      input.memberId,
      input.userId,
    );
}

/** Closes only access justified by one membership, evaluated inside the committing batch. */
export async function buildMembershipAccessOffboardingStatements(
  db: DatabaseLike,
  input: { userId: string; memberId: string; causeKey: string; at: string },
): Promise<StatementLike[]> {
  return [
    enqueueMembershipRemovals(db, input),
    db
      .prepare(
        `UPDATE working_group_members AS seat
            SET left_at = ?
          WHERE seat.user_id = ? AND seat.left_at IS NULL
            AND (
              seat.member_id = ?
              OR (
                seat.member_id IS NULL
                AND NOT EXISTS (
                  SELECT 1
                    FROM members remaining_member
                    LEFT JOIN organization_representatives remaining_rep
                      ON remaining_rep.member_id = remaining_member.id
                     AND remaining_rep.user_id = ? AND remaining_rep.left_at IS NULL
                   WHERE remaining_member.id != ? AND remaining_member.status = 'active'
                     AND (remaining_member.user_id = ? OR remaining_rep.id IS NOT NULL)
                )
              )
            )`,
      )
      .bind(input.at, input.userId, input.memberId, input.userId, input.memberId, input.userId),
  ];
}
