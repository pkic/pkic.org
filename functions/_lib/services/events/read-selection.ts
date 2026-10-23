import { buildOffsetPageSql, type OffsetPageQuery } from "../../db/pagination";
import { buildD1JsonMembershipFilter } from "../../db/json-membership";

export type EventReadSelection = readonly string[] | { slug: string } | { pages: readonly OffsetPageQuery[] };

/** The column is a trusted source expression; IDs/slugs always remain bound values. */
export function eventReadSelectionSql(
  column: string,
  selection: EventReadSelection,
): { sql: string; bindings: unknown[]; withSql?: string } {
  if ("pages" in selection) {
    const pages = selection.pages.map((page, index) => ({
      page,
      name: `selected_event_page_${index}`,
      sql: buildOffsetPageSql(page),
    }));
    return {
      // Materialize bounded page IDs once per enrichment statement. Keeping
      // canonical authority predicates in sibling CTEs also avoids nesting them
      // into D1's expression-depth limit.
      withSql: pages.map(({ name, sql }) => `${name} AS MATERIALIZED (${sql.pageSql})`).join(", "),
      sql: pages.length ? `${column} IN (${pages.map(({ name }) => `SELECT id FROM ${name}`).join(" UNION ")})` : "0",
      bindings: pages.flatMap(({ page, sql }) => [...sql.bindings, page.limit, page.offset]),
    };
  }
  return "slug" in selection
    ? { sql: `${column} IN (SELECT id FROM events WHERE slug=?)`, bindings: [selection.slug] }
    : buildD1JsonMembershipFilter(column, selection);
}
