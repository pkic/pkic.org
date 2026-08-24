import type { DatabaseLike, StatementLike } from "../../types";

export function prepareRepresentationMailingListRemovals(
  db: DatabaseLike,
  input: { userId: string; memberId: string; representativeId: string; at: string },
): StatementLike {
  return db
    .prepare(
      `INSERT OR IGNORE INTO google_groups_sync_queue
         (id, user_id, action, google_group_email, idempotency_key, status, attempts,
          last_error, next_attempt_at, created_at, processed_at)
       SELECT 'google-sync:' || lower(hex(randomblob(16))), ?, 'remove_from_list', list.email,
              'representative:' || ? || ':blocked:google-group:' || list.email,
              'pending', 0, NULL, ?, ?, NULL
         FROM mailing_lists list
        WHERE list.active = 1
          AND (
            (
              list.group_id IS NOT NULL
              AND EXISTS (
                SELECT 1 FROM group_memberships removed_capacity
                 WHERE removed_capacity.group_id = list.group_id
                   AND removed_capacity.user_id = ?
                   AND removed_capacity.member_id = ?
                   AND removed_capacity.left_at IS NULL
              )
              AND NOT EXISTS (
                SELECT 1 FROM group_memberships remaining_capacity
                 WHERE remaining_capacity.group_id = list.group_id
                   AND remaining_capacity.user_id = ?
                   AND remaining_capacity.member_id != ?
                   AND remaining_capacity.left_at IS NULL
              )
            )
            OR (
              list.purpose IN ('all_members', 'consultation')
              AND EXISTS (
                SELECT 1 FROM member_category_assignments removed_category
                 WHERE removed_category.member_id = ?
                   AND (
                     list.auto_sync_categories_json IS NULL
                     OR EXISTS (
                       SELECT 1 FROM json_each(list.auto_sync_categories_json)
                        WHERE value = removed_category.category_code
                     )
                   )
              )
              AND NOT EXISTS (
                SELECT 1
                  FROM members remaining_member
                  JOIN member_category_assignments remaining_category
                    ON remaining_category.member_id = remaining_member.id
                  LEFT JOIN organization_representatives remaining_representation
                    ON remaining_representation.member_id = remaining_member.id
                   AND remaining_representation.user_id = ?
                   AND remaining_representation.left_at IS NULL
                   AND remaining_representation.blocked_at IS NULL
                 WHERE remaining_member.id != ?
                   AND remaining_member.status = 'active'
                   AND (
                     remaining_member.user_id = ?
                     OR remaining_representation.id IS NOT NULL
                   )
                   AND (
                     list.auto_sync_categories_json IS NULL
                     OR EXISTS (
                       SELECT 1 FROM json_each(list.auto_sync_categories_json)
                        WHERE value = remaining_category.category_code
                     )
                   )
              )
            )
          )
        ORDER BY list.email`,
    )
    .bind(
      input.userId,
      input.representativeId,
      input.at,
      input.at,
      input.userId,
      input.memberId,
      input.userId,
      input.memberId,
      input.memberId,
      input.userId,
      input.memberId,
      input.userId,
    );
}
