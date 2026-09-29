export interface D1JsonMembershipFilter {
  sql: string;
  bindings: string[];
}

type JsonMembershipValue = string | number;

/**
 * Builds a D1-safe set-membership predicate using one JSON binding.
 *
 * D1 permits at most 100 bound parameters per statement, while canonical
 * list pages may contain 200 rows. Expanding an ID list into `?, ?, ...`
 * therefore fails at valid page sizes. SQLite's built-in `json_each` keeps
 * the statement at one binding without splitting a logically set-based read
 * into multiple queries.
 *
 * `expression` is a trusted SQL fragment owned by the calling service. User
 * values are serialized into the bound JSON array and are never interpolated.
 */
export function buildD1JsonMembershipFilter(
  expression: string,
  values: readonly JsonMembershipValue[],
): D1JsonMembershipFilter {
  if (!expression.trim()) {
    throw new Error("A trusted SQL expression is required");
  }
  if (values.length === 0) {
    return { sql: "0 = 1", bindings: [] };
  }
  return {
    sql: `${expression} IN (SELECT value FROM json_each(?))`,
    bindings: [JSON.stringify(values)],
  };
}
