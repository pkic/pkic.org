/** Portable D1 database shape shared by Worker services and native local tooling. */
export interface D1StatementResult<T = Record<string, unknown>> {
  success: boolean;
  results?: T[];
  meta?: { changes: number };
}

export interface StatementLike {
  bind(...values: unknown[]): StatementLike;
  run<T = Record<string, unknown>>(): Promise<D1StatementResult<T>>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(columnName?: string): Promise<T | null>;
}

export interface DatabaseLike {
  prepare(query: string): StatementLike;
  batch(statements: StatementLike[]): Promise<D1StatementResult[]>;
  exec?(query: string): Promise<unknown>;
  withSession?(constraintOrBookmark?: string): DatabaseLike & { getBookmark?(): string | null };
  getBookmark?(): string | null;
}
