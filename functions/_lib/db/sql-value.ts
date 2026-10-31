/** A trusted server-side scalar selection, composed into a prepared statement. */
export interface SqlSelection {
  sql: string;
  bindings: readonly unknown[];
}

export type SqlId = string | SqlSelection;

/** Bind ordinary values; resolve database-dependent IDs inside the caller's atomic batch. */
export function sqlValue(value: SqlId | null): { sql: string; bindings: unknown[] } {
  return typeof value === "object" && value !== null
    ? { sql: `(${value.sql})`, bindings: [...value.bindings] }
    : { sql: "?", bindings: [value] };
}
