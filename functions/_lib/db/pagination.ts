import type { DatabaseLike, D1StatementResult } from "../types";

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
 * Runs a page query and its count in one D1 batch. Both statements are derived
 * from one unpaginated SELECT and one binding set, so a caller cannot change
 * the page predicate without changing the count predicate too.
 */
export async function queryPage<T>(db: DatabaseLike, query: OffsetPageQuery): Promise<{ rows: T[]; total: number }> {
  const baseSql = withoutTrailingSemicolon(query.sql);
  const [pageResult, countResult] = await db.batch([
    db
      .prepare(`${baseSql}${query.orderBy ? `\n${query.orderBy}` : ""}\nLIMIT ? OFFSET ?`)
      .bind(...(query.bindings ?? []), query.limit, query.offset),
    db.prepare(`SELECT COUNT(*) AS total FROM (${baseSql}) AS query_page_rows`).bind(...(query.bindings ?? [])),
  ]);

  return {
    rows: batchRows<T>(pageResult),
    total: Number(batchFirst<{ total: number }>(countResult)?.total ?? 0),
  };
}
