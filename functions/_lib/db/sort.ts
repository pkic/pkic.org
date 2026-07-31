/**
 * Shared `ORDER BY` whitelist helper for admin list endpoints' `?sort=`
 * query param (e.g. `sort=name` / `sort=-name` for descending) — generalizes
 * the pattern `admin-applications.ts`'s `resolveApplicationsOrderBy`
 * originated, so each list service doesn't hand-roll its own copy. Column
 * names are never interpolated from the request without passing through
 * `allowedColumns` first, so this is the only thing standing between
 * `?sort=` and a raw SQL `ORDER BY` clause — any caller MUST pass the exact
 * set of column expressions it's safe to order by.
 */
export function resolveOrderBy(sort: string | undefined, allowedColumns: readonly string[], fallback: string): string {
  if (!sort) return fallback;
  const desc = sort.startsWith("-");
  const column = desc ? sort.slice(1) : sort;
  if (!allowedColumns.includes(column)) return fallback;
  return `ORDER BY ${column} ${desc ? "DESC" : "ASC"}`;
}
