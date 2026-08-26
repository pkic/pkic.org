import type { D1StatementResult, DatabaseLike, StatementLike } from "../../functions/_lib/types";

/** Runs one caller-owned mutation after service preflight and before its next D1 batch. */
export function mutateBeforeNextBatch(db: DatabaseLike, mutation: () => Promise<unknown>): DatabaseLike {
  let pending = mutation;
  return {
    prepare: (sql: string) => db.prepare(sql),
    batch: async (statements: StatementLike[]): Promise<D1StatementResult[]> => {
      const runMutation = pending;
      pending = async () => undefined;
      await runMutation();
      return db.batch(statements);
    },
  };
}

/** Runs one caller-owned mutation before the next single-statement read or write. */
export function mutateBeforeNextStatement(db: DatabaseLike, mutation: () => Promise<unknown>): DatabaseLike {
  let pending = mutation;
  let applied = false;
  const applyMutation = async (): Promise<void> => {
    if (applied) return;
    applied = true;
    await pending();
    pending = async () => undefined;
  };
  const wrap = (statement: StatementLike): StatementLike => ({
    bind(...values: unknown[]): StatementLike {
      return wrap(statement.bind(...values));
    },
    async run<T = Record<string, unknown>>() {
      await applyMutation();
      return statement.run<T>();
    },
    async all<T = Record<string, unknown>>() {
      await applyMutation();
      return statement.all<T>();
    },
    async first<T = Record<string, unknown>>(columnName?: string) {
      await applyMutation();
      return statement.first<T>(columnName);
    },
  });
  return {
    prepare: (sql: string) => wrap(db.prepare(sql)),
    batch: (statements: StatementLike[]) => db.batch(statements),
  };
}
