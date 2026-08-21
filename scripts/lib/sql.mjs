/** Quote a value as a SQLite string literal. */
export function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

/** Render optional text as either a trimmed SQLite string literal or NULL. */
export function toSqlNullableText(value) {
  if (value === null || value === undefined) return "NULL";
  const text = String(value).trim();
  return text.length === 0 ? "NULL" : sqlString(text);
}

/** Preserve non-empty seed values verbatim while treating blank text as NULL. */
export function toSqlNullableTextPreservingWhitespace(value) {
  if (value === null || value === undefined || String(value).trim().length === 0) return "NULL";
  return sqlString(value);
}
