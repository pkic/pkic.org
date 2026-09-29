import { MAILING_LIST_SORT_COLUMNS, type MailingListsListQuery } from "../../../assets/shared/schemas/mailing-lists";
import { buildD1TextSearchFilter } from "../db/search";
import { resolveMappedOrderBy } from "../db/sort";

/** Adds the public mailing-list filters using bound values only. */
export function appendMailingListFilters(
  query: MailingListsListQuery,
  conditions: string[],
  bindings: unknown[],
): void {
  const search = query.q ? buildD1TextSearchFilter(query.q, ["email", "label", "purpose"]) : null;
  if (search) {
    conditions.push(search.sql);
    bindings.push(...search.bindings);
  }
  if (query.purpose) {
    conditions.push("purpose = ?");
    bindings.push(query.purpose);
  }
  if (query.active !== undefined) conditions.push(query.active ? "active = 1" : "active = 0");
  if (query.primaryDiscussion !== undefined) {
    conditions.push(query.primaryDiscussion ? "is_primary_discussion = 1" : "is_primary_discussion = 0");
  }
}

/** Resolves the shared public sort vocabulary to trusted database expressions. */
export function resolveMailingListOrderBy(sort: string | undefined, fallback: string): string {
  return resolveMappedOrderBy(
    sort,
    {
      email: "email COLLATE NOCASE",
      label: "label COLLATE NOCASE",
      purpose: "purpose",
      active: "active",
      created_at: "created_at",
    } satisfies Record<(typeof MAILING_LIST_SORT_COLUMNS)[number], string>,
    fallback,
    "id ASC",
  );
}
