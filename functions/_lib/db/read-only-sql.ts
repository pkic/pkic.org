/** Conservative routing hint for trusted internal SQL, never a validator for untrusted SQL. */
export function isReadOnlySql(sql: string): boolean {
  // Ignore quoted values/identifiers and comments before inspecting keywords.
  // Anything ambiguous retains the primary write guard, including unknown statements.
  const tokens = sql
    .replace(/'(?:[^']|'')*'|"(?:[^"]|"")*"|`(?:[^`]|``)*`|\[[^\]]*\]|--[^\r\n]*|\/\*[\s\S]*?\*\//g, " ")
    .trim()
    .replace(/;\s*$/, "");
  return (
    /^(?:SELECT|WITH)\b/i.test(tokens) &&
    !tokens.includes(";") &&
    !/\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|PRAGMA|ATTACH|DETACH|VACUUM|REINDEX|ANALYZE|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/i.test(
      tokens,
    )
  );
}
