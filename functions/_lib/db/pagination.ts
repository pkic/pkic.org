import type { DatabaseLike, D1StatementResult, StatementLike } from "../types";

export function batchRows<T>(result: D1StatementResult): T[] {
  return (result.results ?? []) as T[];
}

export function batchFirst<T>(result: D1StatementResult): T | null {
  return (result.results?.[0] as T | undefined) ?? null;
}

interface OffsetPageQueryBase {
  /** Trusted, allowlisted ordering for the page query only. */
  orderBy?: string;
  limit: number;
  offset: number;
}

export interface OffsetPageSource {
  /** Optional CTE prefix shared by the page and count statements. */
  withSql?: string;
  /** Projection used by the page statement. */
  selectSql: string;
  /**
   * Canonical FROM/JOIN/WHERE source shared by page and count. It must yield
   * one row per page row; callers with 1:N joins must use countSelectSql (for
   * example, `SELECT COUNT(DISTINCT parent.id) AS total`).
   */
  fromSql: string;
  bindings?: readonly unknown[];
  /** Optional lean FROM/WHERE source used only by the count statement. */
  countFromSql?: string;
  /** Bindings for countFromSql when its source omits page-only placeholders. */
  countBindings?: readonly unknown[];
  /** Optional trusted, lean count projection for non-cardinality-preserving sources. */
  countSelectSql?: string;
}

export type OffsetPageQuery =
  | (OffsetPageQueryBase & {
      /**
       * One unpaginated SELECT. Kept for callers whose source is already a
       * complete read model (including CTEs).
       */
      sql: string;
      source?: never;
      bindings?: readonly unknown[];
    })
  | (OffsetPageQueryBase & {
      /**
       * A canonical projection/source pair. The source contains the FROM, JOIN,
       * and WHERE clauses exactly once. The page uses the projection, while the
       * count uses the same source with a lean COUNT(*) projection, so filters and
       * bindings cannot drift between the two statements.
       */
      source: OffsetPageSource;
      sql?: never;
      bindings?: never;
    });

function withoutTrailingSemicolon(sql: string): string {
  return sql.trim().replace(/;$/, "");
}

export interface OffsetPageSql {
  pageSql: string;
  countSql: string;
  bindings: readonly unknown[];
  countBindings: readonly unknown[];
}

/** Build the page/count SQL pair without preparing it. Useful for EXPLAIN tests. */
export function buildOffsetPageSql(query: OffsetPageQuery): OffsetPageSql {
  if ((query.sql === undefined) === (query.source === undefined)) {
    throw new Error("Offset page query requires exactly one of sql or source");
  }
  if (query.source && query.bindings) {
    throw new Error("Offset page query bindings belong in source when source is used");
  }
  const sourceWithSql = query.source?.withSql ? `${withoutTrailingSemicolon(query.source.withSql)}\n` : "";
  const baseSql = query.source
    ? `${sourceWithSql}${withoutTrailingSemicolon(query.source.selectSql)}\n${withoutTrailingSemicolon(query.source.fromSql)}`
    : withoutTrailingSemicolon(query.sql as string);
  const countSql = query.source
    ? `${sourceWithSql}${query.source.countSelectSql ?? "SELECT COUNT(*) AS total"}\n${withoutTrailingSemicolon(
        query.source.countFromSql ?? query.source.fromSql,
      )}`
    : `SELECT COUNT(*) AS total FROM (${baseSql}) AS query_page_rows`;
  const bindings = query.source?.bindings ?? query.bindings ?? [];
  const countBindings = query.source?.countBindings ?? bindings;
  return {
    pageSql: `${baseSql}${query.orderBy ? `\n${query.orderBy}` : ""}\nLIMIT ? OFFSET ?`,
    countSql,
    bindings,
    countBindings,
  };
}

/**
 * Builds the two statements for an offset page from one unpaginated query.
 * Services that need their own aggregates can append these statements to a
 * larger D1 batch and decode the first two results with
 * `decodeOffsetPageResults`.
 */
export function buildOffsetPageStatements(db: DatabaseLike, query: OffsetPageQuery): [StatementLike, StatementLike] {
  const { pageSql, countSql, bindings, countBindings } = buildOffsetPageSql(query);
  return [
    db.prepare(pageSql).bind(...bindings, query.limit, query.offset),
    db.prepare(countSql).bind(...countBindings),
  ];
}

/** Decode the page/count pair returned by `buildOffsetPageStatements`. */
export function decodeOffsetPageResults<T>(
  pageResult: D1StatementResult,
  countResult: D1StatementResult,
): { rows: T[]; total: number } {
  return {
    rows: batchRows<T>(pageResult),
    total: Number(batchFirst<{ total: number }>(countResult)?.total ?? 0),
  };
}

/**
 * Runs a page query and its count in one D1 batch. Both statements are derived
 * from one unpaginated SELECT and one binding set, so a caller cannot change
 * the page predicate without changing the count predicate too.
 */
export async function queryPage<T>(db: DatabaseLike, query: OffsetPageQuery): Promise<{ rows: T[]; total: number }> {
  const [pageResult, countResult] = await db.batch(buildOffsetPageStatements(db, query));
  return decodeOffsetPageResults<T>(pageResult, countResult);
}
