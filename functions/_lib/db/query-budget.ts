import type { DatabaseLike, D1StatementResult, StatementLike } from "../types";

export class D1QueryBudgetExceededError extends Error {
  readonly requestedQueries: number;
  readonly remainingQueries: number;

  constructor(requestedQueries: number, remainingQueries: number) {
    super(`D1 query budget exhausted: requested ${requestedQueries}, ${remainingQueries} remaining`);
    this.name = "D1QueryBudgetExceededError";
    this.requestedQueries = requestedQueries;
    this.remainingQueries = remainingQueries;
  }
}

export interface D1QueryBudget {
  readonly maxQueries: number;
  usedQueries(): number;
  remainingQueries(): number;
}

/**
 * Checks an invocation-local D1 statement budget before starting an atomic
 * batch. Callers must still pass the same budgeted database to the batch so
 * the statement counter remains authoritative.
 */
export function hasD1QueryCapacity(budget: D1QueryBudget | undefined, requiredQueries: number): boolean {
  if (!budget) return true;
  return budget.remainingQueries() >= Math.max(0, Math.floor(requiredQueries));
}

interface MutableD1QueryBudget extends D1QueryBudget {
  consume(count: number): void;
}

const RAW_STATEMENT = Symbol("rawD1Statement");
type BudgetedStatement = StatementLike & { [RAW_STATEMENT]: StatementLike };

function createBudget(maxQueries: number): MutableD1QueryBudget {
  const normalizedMaximum = Math.max(1, Math.floor(maxQueries));
  let used = 0;
  return {
    maxQueries: normalizedMaximum,
    usedQueries: () => used,
    remainingQueries: () => Math.max(0, normalizedMaximum - used),
    consume(count: number) {
      const normalizedCount = Math.max(0, Math.floor(count));
      const remaining = normalizedMaximum - used;
      if (normalizedCount > remaining) {
        throw new D1QueryBudgetExceededError(normalizedCount, Math.max(0, remaining));
      }
      used += normalizedCount;
    },
  };
}

function wrapStatement(statement: StatementLike, budget: MutableD1QueryBudget): BudgetedStatement {
  return {
    [RAW_STATEMENT]: statement,
    bind(...values: unknown[]): StatementLike {
      return wrapStatement(statement.bind(...values), budget);
    },
    async run<T = Record<string, unknown>>(): Promise<D1StatementResult<T>> {
      budget.consume(1);
      return statement.run<T>();
    },
    async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
      budget.consume(1);
      return statement.all<T>();
    },
    async first<T = Record<string, unknown>>(columnName?: string): Promise<T | null> {
      budget.consume(1);
      return statement.first<T>(columnName);
    },
  };
}

function countExecStatements(sql: string): number {
  // Conservative for the scheduled-job use case: semicolons inside literals
  // can only over-count, while every executable statement still consumes at
  // least one unit. Scheduled application code normally uses prepare/batch.
  return Math.max(1, sql.split(";").filter((part) => part.trim().length > 0).length);
}

function wrapDatabase(db: DatabaseLike, budget: MutableD1QueryBudget): DatabaseLike {
  const wrapped: DatabaseLike = {
    prepare(query: string): StatementLike {
      return wrapStatement(db.prepare(query), budget);
    },
    async batch(statements: StatementLike[]): Promise<D1StatementResult[]> {
      budget.consume(statements.length);
      const rawStatements = statements.map((statement) =>
        RAW_STATEMENT in statement ? (statement as BudgetedStatement)[RAW_STATEMENT] : statement,
      );
      return db.batch(rawStatements);
    },
  };

  if (db.exec) {
    wrapped.exec = async (query: string): Promise<unknown> => {
      budget.consume(countExecStatements(query));
      return db.exec!(query);
    };
  }
  if (db.withSession) {
    wrapped.withSession = (constraintOrBookmark?: string) => {
      const session = db.withSession!(constraintOrBookmark);
      return Object.assign(wrapDatabase(session, budget), {
        getBookmark: session.getBookmark?.bind(session),
      });
    };
  }
  return wrapped;
}

/**
 * Wraps D1 with an invocation-local statement counter. A D1 batch consumes
 * one query unit per statement, matching Cloudflare's limit accounting.
 */
export function createD1QueryBudgetedDatabase(
  db: DatabaseLike,
  maxQueries: number,
): { db: DatabaseLike; budget: D1QueryBudget } {
  const budget = createBudget(maxQueries);
  return { db: wrapDatabase(db, budget), budget };
}
