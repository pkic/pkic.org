import type { AuditFilterOptionsQuery } from "../../../assets/shared/schemas/audit-filter-options";
import { buildPageInfo } from "../../../assets/shared/schemas/pagination";
import { queryPage } from "../db/pagination";
import { buildD1TextSearchFilter } from "../db/search";
import { resolveMappedOrderBy } from "../db/sort";
import type { DatabaseLike } from "../types";

const COLUMNS = { action: "action", entityType: "entity_type", actorType: "actor_type" } as const;

export async function listAuditFilterOptions(db: DatabaseLike, query: AuditFilterOptionsQuery) {
  const column = COLUMNS[query.field];
  const search = query.q ? buildD1TextSearchFilter(query.q, [column]) : null;
  const { rows, total } = await queryPage<{ value: string }>(db, {
    sql: `SELECT DISTINCT ${column} AS value FROM audit_log${search ? ` WHERE ${search.sql}` : ""}`,
    bindings: search?.bindings ?? [],
    orderBy: resolveMappedOrderBy(
      query.sort,
      { value: "value COLLATE NOCASE" },
      "value COLLATE NOCASE ASC",
      "value ASC",
    ),
    limit: query.limit,
    offset: query.offset,
  });
  return {
    options: rows.map(({ value }) => ({ value, label: value.replace(/_/g, " ") })),
    page: buildPageInfo(query.limit, query.offset, total, rows.length),
  };
}
