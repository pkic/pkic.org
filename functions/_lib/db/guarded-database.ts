import type { D1StatementResult, DatabaseLike, StatementLike } from "../types";

export type GuardedBatchExecutor = (statements: StatementLike[]) => Promise<D1StatementResult[]>;

/**
 * Wraps every statement and batch in caller-supplied live authorization.
 * The executor returns results for the protected statements only, excluding
 * any guard statements it prepends.
 */
export function guardDatabaseBatches(db: DatabaseLike, execute: GuardedBatchExecutor): DatabaseLike {
  const guardedStatements = new WeakMap<StatementLike, StatementLike>();
  return {
    prepare(query: string): StatementLike {
      let statement = db.prepare(query);
      const guarded: StatementLike = {
        bind(...values: unknown[]): StatementLike {
          statement = statement.bind(...values);
          guardedStatements.set(guarded, statement);
          return guarded;
        },
        async run<T = Record<string, unknown>>(): Promise<D1StatementResult<T>> {
          const [result] = await execute([statement]);
          return result as D1StatementResult<T>;
        },
        async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
          const [result] = await execute([statement]);
          return { results: (result.results ?? []) as T[] };
        },
        async first<T = Record<string, unknown>>(columnName?: string): Promise<T | null> {
          const { results } = await guarded.all<Record<string, unknown>>();
          const row = results[0];
          if (!row) return null;
          return (columnName ? row[columnName] : row) as T;
        },
      };
      guardedStatements.set(guarded, statement);
      return guarded;
    },
    batch(statements: StatementLike[]): Promise<D1StatementResult[]> {
      return execute(statements.map((statement) => guardedStatements.get(statement) ?? statement));
    },
  };
}
