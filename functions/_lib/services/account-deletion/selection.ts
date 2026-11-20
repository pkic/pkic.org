import {
  ACCOUNT_DELETION_BLOCKING_RULES,
  ACCOUNT_DELETION_REMOVED_TABLES,
  type AccountDeletionBlockingRule,
  type AccountDeletionLink,
  type AccountDeletionRemovedTable,
} from "./registry";

/**
 * Turns the registry into SQL. Every fragment comes from fixed internal
 * strings; the only value is the account id, bound as `?1`.
 */
const removedTables = new Map(ACCOUNT_DELETION_REMOVED_TABLES.map((entry) => [entry.table, entry]));

function removedTable(table: string): AccountDeletionRemovedTable {
  const entry = removedTables.get(table);
  if (!entry) throw new Error(`Account deletion has no rule for parent table ${table}`);
  return entry;
}

function linkPredicate(link: AccountDeletionLink, alias: string, depth: number): string {
  const parent = link.from ?? "users";
  const match =
    parent === "users"
      ? `${alias}.${link.column} = ?1`
      : `${alias}.${link.column} IN (SELECT p${depth}.${link.key ?? "id"} FROM ${parent} p${depth} WHERE ${removedRowPredicate(parent, `p${depth}`, depth + 1)})`;
  return link.where ? `(${match} AND ${link.where(alias)})` : `(${match})`;
}

/** The rows of `table` that are deleted with the account. */
export function removedRowPredicate(table: string, alias: string, depth = 0): string {
  return removedTable(table)
    .links.map((link) => linkPredicate(link, alias, depth))
    .join(" OR ");
}

/** The rows a blocking rule finds, any one of which keeps the account. */
export function blockingRowPredicate(rule: AccountDeletionBlockingRule, alias: string): string {
  return linkPredicate(rule, alias, 0);
}

const REMOVED_COUNT_EXPRESSIONS = ACCOUNT_DELETION_REMOVED_TABLES.map(
  ({ table }) => `(SELECT count(*) FROM ${table} r WHERE ${removedRowPredicate(table, "r")})`,
);

/** One count per removed table, then one per blocking rule, in registry order. */
export const ACCOUNT_DELETION_COUNT_EXPRESSIONS: readonly string[] = [
  ...REMOVED_COUNT_EXPRESSIONS,
  ...ACCOUNT_DELETION_BLOCKING_RULES.map(
    (rule) => `(SELECT count(*) FROM ${rule.table} b WHERE ${blockingRowPredicate(rule, "b")})`,
  ),
];

/** D1 caps expression depth at 100, so a long conjunction is nested as a balanced tree. */
function balancedConjunction(terms: readonly string[]): string {
  if (terms.length === 1) return terms[0];
  const middle = Math.ceil(terms.length / 2);
  return `(${balancedConjunction(terms.slice(0, middle))}\n AND ${balancedConjunction(terms.slice(middle))})`;
}

/** True while nothing keeps the account; checked inside the delete batch. */
export const ACCOUNT_DELETION_UNBLOCKED_SQL = balancedConjunction(
  ACCOUNT_DELETION_BLOCKING_RULES.map(
    (rule) => `NOT EXISTS (SELECT 1 FROM ${rule.table} b WHERE ${blockingRowPredicate(rule, "b")})`,
  ),
);

/** The account's linked addresses, normalized, sorted, and space-separated; NULL without any. */
export const ACCOUNT_DELETION_LINKED_ADDRESSES_SQL = `(SELECT group_concat(normalized_email, ' ') FROM (
  SELECT normalized_email FROM user_emails WHERE user_id = ?1 ORDER BY normalized_email
))`;

/**
 * The account's renders as id, format, and cache key, which name their stored
 * files; NULL without any. A replaced render keeps the count but not this.
 */
export const ACCOUNT_DELETION_RENDER_FILES_SQL = `(SELECT group_concat(id || ':' || format || ':' || cache_key, ' ') FROM (
  SELECT id, format, cache_key FROM event_promotion_renders WHERE user_id = ?1 ORDER BY id
))`;

/**
 * True while each removed table still holds the rows the preview counted, so
 * the batch deletes exactly what staff reviewed. The counts are integers the
 * preview read from the database, written into the SQL to stay within D1's
 * bound-parameter limit.
 */
export function accountDeletionUnchangedSql(removedCounts: readonly number[]): string {
  if (
    removedCounts.length !== REMOVED_COUNT_EXPRESSIONS.length ||
    !removedCounts.every((count) => Number.isSafeInteger(count) && count >= 0)
  ) {
    throw new Error("Account deletion needs one row count per removed table");
  }
  return balancedConjunction(
    REMOVED_COUNT_EXPRESSIONS.map((expression, index) => `${expression} = ${removedCounts[index]}`),
  );
}

/**
 * Deletes children before parents: the registry lists parents first, and the
 * coverage test holds it to that order for every foreign key between them.
 */
export const ACCOUNT_DELETION_DELETE_SQL: readonly string[] = [...ACCOUNT_DELETION_REMOVED_TABLES]
  .reverse()
  .flatMap(({ table, erasure }) => {
    const remove = `DELETE FROM ${table} AS r WHERE ${removedRowPredicate(table, "r")}`;
    return erasure ? [erasure.before, remove, erasure.after] : [remove];
  });
