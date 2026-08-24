import { MAILING_LIST_SORT_COLUMNS, type MailingListsListQuery } from "../../../../assets/shared/schemas/mailing-lists";
import { queryPage } from "../../db/pagination";
import { all } from "../../db/queries";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import type { DatabaseLike } from "../../types";
import { MAILING_LIST_COLUMNS, type MailingListRow, toMailingList } from "./record";

export async function listMailingLists(db: DatabaseLike, query: MailingListsListQuery) {
  const conditions: string[] = [];
  const bindings: unknown[] = [];
  const search = query.q ? buildD1TextSearchFilter(query.q, ["email", "label", "purpose"]) : null;
  if (search) {
    conditions.push(search.sql);
    bindings.push(...search.bindings);
  }
  if (query.groupId) {
    conditions.push("group_id = ?");
    bindings.push(query.groupId);
  }
  if (query.purpose) {
    conditions.push("purpose = ?");
    bindings.push(query.purpose);
  }
  if (query.active !== undefined) conditions.push(query.active ? "active = 1" : "active = 0");
  if (query.primaryDiscussion !== undefined) {
    conditions.push(query.primaryDiscussion ? "is_primary_discussion = 1" : "is_primary_discussion = 0");
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows, total } = await queryPage<MailingListRow>(db, {
    sql: `SELECT ${MAILING_LIST_COLUMNS} FROM mailing_lists ${where}`,
    bindings,
    orderBy: resolveMappedOrderBy(
      query.sort,
      {
        email: "email COLLATE NOCASE",
        label: "label COLLATE NOCASE",
        purpose: "purpose",
        active: "active",
        created_at: "created_at",
      } satisfies Record<(typeof MAILING_LIST_SORT_COLUMNS)[number], string>,
      "purpose ASC, email ASC",
      "id ASC",
    ),
    limit: query.limit,
    offset: query.offset,
  });
  return { mailingLists: rows.map(toMailingList), total };
}

export async function resolveAutoSyncListEmails(db: DatabaseLike, membershipCategory: string): Promise<string[]> {
  const rows = await all<Pick<MailingListRow, "email">>(
    db,
    `SELECT email FROM mailing_lists
      WHERE active = 1 AND archived_at IS NULL
        AND purpose IN ('all_members', 'consultation')
        AND (
          auto_sync_categories_json IS NULL
          OR EXISTS (
            SELECT 1 FROM json_each(mailing_lists.auto_sync_categories_json) WHERE value = ?
          )
        )
      ORDER BY email ASC`,
    [membershipCategory],
  );
  return rows.map((row) => row.email);
}
