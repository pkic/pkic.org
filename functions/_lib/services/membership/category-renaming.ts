/** Prepare a category-code rename inside the caller's guarded atomic batch. */
import type { DatabaseLike, StatementLike } from "../../types";
import { prepareAuthorizationGuard } from "../../db/authorization-guard";

export function prepareMembershipCategoryRename(
  db: DatabaseLike,
  oldCode: string,
  newCode: string,
  expectedRevision: number,
  now: string,
): StatementLike[] {
  if (oldCode === newCode) return [];
  return [
    prepareAuthorizationGuard(db, {
      sql: `SELECT 1 FROM membership_categories WHERE code = ? AND revision = ?
        AND NOT EXISTS (SELECT 1 FROM membership_categories WHERE code = ?)`,
      bindings: [oldCode, expectedRevision, newCode],
    }),
    db
      .prepare(
        `INSERT INTO membership_categories
      (code, label, description, display_order, is_voting, is_individual, requires_university_email,
       retired_at, workflow_version_id, revision, updated_at)
      SELECT ?, label, description, display_order, is_voting, is_individual, requires_university_email,
       retired_at, workflow_version_id, revision, updated_at FROM membership_categories WHERE code = ?`,
      )
      .bind(newCode, oldCode),
    db
      .prepare(
        `UPDATE groups SET revision = revision + 1, updated_at = ? WHERE id IN
      (SELECT group_id FROM group_membership_category_rules WHERE membership_category_code = ?)`,
      )
      .bind(now, oldCode),
    db
      .prepare(
        `UPDATE group_membership_category_rules SET membership_category_code = ?, updated_at = ?
      WHERE membership_category_code = ?`,
      )
      .bind(newCode, now, oldCode),
    db
      .prepare(`UPDATE member_category_assignments SET category_code = ?, updated_at = ? WHERE category_code = ?`)
      .bind(newCode, now, oldCode),
    db
      .prepare(
        `UPDATE member_applications SET membership_category = ?, transition_revision = transition_revision + 1,
      updated_at = ? WHERE membership_category = ?`,
      )
      .bind(newCode, now, oldCode),
    db
      .prepare(
        `UPDATE membership_application_workflows SET category_code = ?, revision = revision + 1
      WHERE category_code = ?`,
      )
      .bind(newCode, oldCode),
    db
      .prepare(`UPDATE membership_fee_intents SET category_code = ?, updated_at = ? WHERE category_code = ?`)
      .bind(newCode, now, oldCode),
    ...(
      [
        ["votes", "eligible_categories"],
        ["vote_proposals", "eligible_categories"],
        ["mailing_lists", "auto_sync_categories_json"],
      ] as const
    ).map(([table, column]) =>
      db
        .prepare(
          `UPDATE ${table}
      SET ${column} = (SELECT json_group_array(CASE WHEN value = ? THEN ? ELSE value END)
        FROM json_each(${table}.${column})), updated_at = ?${table === "mailing_lists" ? "" : ", transition_revision = transition_revision + 1"}
      WHERE EXISTS (SELECT 1 FROM json_each(${table}.${column}) WHERE value = ?)`,
        )
        .bind(oldCode, newCode, now, oldCode),
    ),
    db.prepare("DELETE FROM membership_categories WHERE code = ?").bind(oldCode),
  ];
}
