import type { DatabaseLike, D1StatementResult, StatementLike } from "../types";

export function batchRows<T>(result: D1StatementResult): T[] {
  return (result.results ?? []) as T[];
}

export function batchFirst<T>(result: D1StatementResult): T | null {
  return (result.results?.[0] as T | undefined) ?? null;
}

export interface OffsetPageQuery {
  /** One unpaginated SELECT. The helper derives both statements from this exact SQL. */
  sql: string;
  bindings?: readonly unknown[];
  /** Trusted, allowlisted ordering for the page query only. */
  orderBy?: string;
  limit: number;
  offset: number;
}

function withoutTrailingSemicolon(sql: string): string {
  return sql.trim().replace(/;$/, "");
}

/**
 * Builds the two statements for an offset page from one unpaginated query.
 * Services that need their own aggregates can append these statements to a
 * larger D1 batch and decode the first two results with
 * `decodeOffsetPageResults`.
 */
export function buildOffsetPageStatements(db: DatabaseLike, query: OffsetPageQuery): [StatementLike, StatementLike] {
  const baseSql = withoutTrailingSemicolon(query.sql);
  const bindings = query.bindings ?? [];
  return [
    db
      .prepare(`${baseSql}${query.orderBy ? `\n${query.orderBy}` : ""}\nLIMIT ? OFFSET ?`)
      .bind(...bindings, query.limit, query.offset),
    db.prepare(`SELECT COUNT(*) AS total FROM (${baseSql}) AS query_page_rows`).bind(...bindings),
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
