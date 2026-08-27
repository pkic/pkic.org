/**
 * Shared `ORDER BY` whitelist helper for admin list endpoints' `?sort=`
 * query param (e.g. `sort=name` / `sort=-name` for descending) — generalizes
 * the pattern `membership-application-management.ts`'s `resolveApplicationsOrderBy`
 * originated, so each list service doesn't hand-roll its own copy. Column
 * names are never interpolated from the request without passing through
 * `allowedColumns` first, so this is the only thing standing between
 * `?sort=` and a raw SQL `ORDER BY` clause — any caller MUST pass the exact
 * set of column expressions it's safe to order by.
 */
function appendTieBreaker(orderBy: string, tieBreaker: string): string {
  const normalizedTie = tieBreaker.trim().toLowerCase();
  const existingTerms = orderBy
    .replace(/^ORDER\s+BY\s+/i, "")
    .split(",")
    .map((term) => term.trim().toLowerCase());
  return existingTerms.includes(normalizedTie) ? orderBy : `${orderBy}, ${tieBreaker}`;
}

export function resolveOrderBy(
  sort: string | undefined,
  allowedColumns: readonly string[],
  fallback: string,
  tieBreaker: string,
): string {
  if (!sort) return appendTieBreaker(fallback, tieBreaker);
  const desc = sort.startsWith("-");
  const column = desc ? sort.slice(1) : sort;
  if (!allowedColumns.includes(column)) return appendTieBreaker(fallback, tieBreaker);
  return appendTieBreaker(`ORDER BY ${column} ${desc ? "DESC" : "ASC"}`, tieBreaker);
}

/**
 * Resolves a public sort key to a trusted SQL expression. The mapping is
 * defined by the service, so neither a request value nor a schema-facing key
 * is interpolated as SQL. `tieBreaker` keeps offset pagination deterministic.
 */
export function resolveMappedOrderBy(
  sort: string | undefined,
  columns: Readonly<Record<string, string>>,
  fallback: string,
  tieBreaker: string,
): string {
  if (!sort) return appendTieBreaker(`ORDER BY ${fallback}`, tieBreaker);
  const desc = sort.startsWith("-");
  const key = desc ? sort.slice(1) : sort;
  const expression = columns[key];
  if (!expression) return appendTieBreaker(`ORDER BY ${fallback}`, tieBreaker);
  return appendTieBreaker(`ORDER BY ${expression} ${desc ? "DESC" : "ASC"}`, tieBreaker);
}
