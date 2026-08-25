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
