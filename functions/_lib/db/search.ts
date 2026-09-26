export interface D1TextSearchFilter {
  sql: string;
  bindings: string[];
}

/**
 * Builds one bound, case-insensitive search predicate for D1 list queries.
 * INSTR preserves contains-search semantics without using D1's 50-byte
 * LIKE/GLOB pattern budget, including for complete email addresses.
 *
 * Expressions must be trusted SQL fragments declared by the calling service;
 * user input is always returned separately as prepared-statement bindings.
 */
export function buildD1TextSearchFilter(query: string, expressions: readonly string[]): D1TextSearchFilter {
  if (expressions.length === 0) {
    throw new Error("At least one trusted search expression is required");
  }

  const normalized = query.trim();
  if (!normalized) {
    throw new Error("Search query must not be empty");
  }

  const predicate = (expression: string) => `INSTR(LOWER(CAST(COALESCE(${expression}, '') AS TEXT)), LOWER(?)) > 0`;

  return {
    sql: `(${expressions.map(predicate).join(" OR ")})`,
    bindings: expressions.map(() => normalized),
  };
}
