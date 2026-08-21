import type { DatabaseLike, D1StatementResult } from "../types";

export function batchRows<T>(result: D1StatementResult): T[] {
  return (result.results ?? []) as T[];
}

export function batchFirst<T>(result: D1StatementResult): T | null {
  return (result.results?.[0] as T | undefined) ?? null;
}

/**
 * Runs a page query and its matching count in one D1 batch. Keeping both
 * statements together reduces Worker-to-D1 round trips and guarantees every
 * list service derives rows and totals from the same WHERE bindings.
 */
export async function queryPage<T>(
  db: DatabaseLike,
  page: { sql: string; bindings?: readonly unknown[] },
  count: { sql: string; bindings?: readonly unknown[] },
): Promise<{ rows: T[]; total: number }> {
  const [pageResult, countResult] = await db.batch([
    db.prepare(page.sql).bind(...(page.bindings ?? [])),
    db.prepare(count.sql).bind(...(count.bindings ?? [])),
  ]);

  return {
    rows: batchRows<T>(pageResult),
    total: Number(batchFirst<{ total: number }>(countResult)?.total ?? 0),
  };
}
