import { sqlString } from "../sql.mjs";

/** D1 refuses a statement above 100 KB; leave headroom for the statement frame. */
export const MAX_STATEMENT_BYTES = 90_000;

/** A trusted SQL expression placed verbatim, such as a subquery resolving an id. */
export function rawSql(sql) {
  return { sql };
}

function literal(value) {
  if (value && typeof value === "object" && "sql" in value) return value.sql;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Not a finite number: ${value}`);
    return String(value);
  }
  if (typeof value === "boolean") return value ? "1" : "0";
  return sqlString(value);
}

/**
 * Multi-row INSERT statements for `rows`, each under the D1 statement limit.
 * `conflict` is the full ON CONFLICT clause; a re-run must not duplicate rows.
 * @param {string} table
 * @param {string[]} columns
 * @param {unknown[][]} rows
 * @param {string} conflict
 */
export function insertStatements(table, columns, rows, conflict = "ON CONFLICT DO NOTHING") {
  const head = `INSERT INTO ${table} (${columns.join(", ")}) VALUES\n`;
  const tail = `\n${conflict};`;
  const bytes = (text) => Buffer.byteLength(text, "utf8");
  const statements = [];
  let batch = [];
  let size = bytes(head) + bytes(tail);
  for (const row of rows) {
    if (row.length !== columns.length) throw new Error(`${table}: expected ${columns.length} values, got ${row.length}`);
    const tuple = `(${row.map(literal).join(", ")})`;
    if (bytes(head) + bytes(tuple) + bytes(tail) > MAX_STATEMENT_BYTES)
      throw new Error(`${table}: one row is ${bytes(tuple)} bytes, too large for a ${MAX_STATEMENT_BYTES}-byte statement`);
    if (batch.length > 0 && size + bytes(tuple) + 2 > MAX_STATEMENT_BYTES) {
      statements.push(head + batch.join(",\n") + tail);
      batch = [];
      size = bytes(head) + bytes(tail);
    }
    batch.push(tuple);
    size += bytes(tuple) + 2;
  }
  if (batch.length > 0) statements.push(head + batch.join(",\n") + tail);
  return statements;
}
