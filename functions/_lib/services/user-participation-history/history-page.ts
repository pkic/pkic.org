/**
 * The one page builder every participation-history collection uses.
 *
 * The four collections read four unrelated sets of tables, but they are the
 * same listing: bound to one person, filtered by one optional search term,
 * ordered by one instant, and returned as one page envelope. Only the SQL
 * that names the rows differs, so only that lives in the collection modules;
 * the search predicate, the WHERE assembly, the allowlisted ORDER BY, and the
 * page/count pairing are written once here.
 *
 * Filtering, ordering, counting, and paging all happen in D1. Nothing in this
 * directory fetches a set and slices it.
 */
import { buildPageInfo, type PageInfo } from "../../../../assets/shared/schemas/pagination";
import type { ParticipationHistoryListQuery } from "../../../../assets/shared/schemas/user-participation-history";
import { queryPage, type OffsetPageQuery } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import type { DatabaseLike } from "../../types";

/**
 * One collection's own SQL. Every fragment here is written by the service and
 * never assembled from request input; the only request-derived values are the
 * bindings, the direction of the allowlisted sort, and the page window.
 */
export interface ParticipationHistorySource {
  /** Optional CTE shared by the page and the count. */
  withSql?: string;
  /** The page projection. */
  selectSql: string;
  /** FROM and JOIN clauses only; the WHERE is assembled from `conditions`. */
  fromSql: string;
  /** Fixed predicates, always including the person this history belongs to. */
  conditions: readonly string[];
  bindings: readonly unknown[];
  /** Trusted expressions the optional `q` searches; at least one. */
  searchColumns: readonly string[];
  /** Appended to the page source only — a grouped page still counts parents. */
  groupBySql?: string;
  /** Required when `groupBySql` collapses rows, so the count matches the page. */
  countSelectSql?: string;
  /** The trusted SQL expression `occurredAt` sorts by. */
  occurredAtExpression: string;
  /** Keeps offset pagination deterministic when two rows share an instant. */
  tieBreaker: string;
}

export function buildParticipationHistoryPageQuery(
  query: ParticipationHistoryListQuery,
  source: ParticipationHistorySource,
): OffsetPageQuery {
  const search = query.q ? buildD1TextSearchFilter(query.q, source.searchColumns) : null;
  const predicates = [...source.conditions, ...(search ? [search.sql] : [])];
  const where = predicates.length > 0 ? `\n WHERE ${predicates.join("\n   AND ")}` : "";
  const scopedFrom = `${source.fromSql}${where}`;
  return {
    source: {
      ...(source.withSql ? { withSql: source.withSql } : {}),
      selectSql: source.selectSql,
      fromSql: `${scopedFrom}${source.groupBySql ? `\n ${source.groupBySql}` : ""}`,
      ...(source.countSelectSql ? { countSelectSql: source.countSelectSql } : {}),
      ...(source.groupBySql ? { countFromSql: scopedFrom } : {}),
      bindings: [...source.bindings, ...(search?.bindings ?? [])],
    },
    orderBy: resolveMappedOrderBy(
      query.sort,
      { occurredAt: source.occurredAtExpression },
      `${source.occurredAtExpression} DESC`,
      source.tieBreaker,
    ),
    limit: query.limit,
    offset: query.offset,
  };
}

/**
 * Runs one collection's page and returns the shared envelope under its own
 * items key. Callers parse the result through their canonical response
 * schema, which is what turns these rows into the published contract.
 */
export async function loadParticipationHistoryPage<Row, Entry>(
  db: DatabaseLike,
  itemsKey: string,
  pageQuery: OffsetPageQuery,
  toEntry: (row: Row) => Entry,
): Promise<Record<string, Entry[] | PageInfo>> {
  const { rows, total } = await queryPage<Row>(db, pageQuery);
  return {
    [itemsKey]: rows.map(toEntry),
    page: buildPageInfo(pageQuery.limit, pageQuery.offset, total, rows.length),
  };
}
