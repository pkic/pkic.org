import { buildD1JsonMembershipFilter } from "../../db/json-membership";

export type EventReadSelection = readonly string[] | { slug: string };

/** The column is a trusted source expression; IDs/slugs always remain bound values. */
export function eventReadSelectionSql(column: string, selection: EventReadSelection) {
  return "slug" in selection
    ? { sql: `${column} IN (SELECT id FROM events WHERE slug=?)`, bindings: [selection.slug] }
    : buildD1JsonMembershipFilter(column, selection);
}
