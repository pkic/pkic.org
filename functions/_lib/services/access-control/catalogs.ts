import {
  accessControlContextSchema,
  type AccessControlContext,
  type AccessControlContextsListQuery,
} from "../../../../assets/shared/schemas/access-control";
import { buildPageInfo, type PageInfo } from "../../../../assets/shared/schemas/pagination";
import { queryPage } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveOrderBy } from "../../db/sort";
import type { DatabaseLike } from "../../types";

interface AccessControlContextRow {
  id: string;
  type: AccessControlContext["type"];
  name: string;
}

/**
 * Lists durable authorization contexts. Organization grants intentionally use
 * members.id, matching the context validation trigger and representative-role
 * ownership model, while the organization name remains the human label.
 */
export async function listAccessControlContexts(
  db: DatabaseLike,
  query: AccessControlContextsListQuery,
): Promise<{ contexts: AccessControlContext[]; page: PageInfo }> {
  const search = query.q ? buildD1TextSearchFilter(query.q, ["contexts.name"]) : null;
  const where = search ? `WHERE ${search.sql}` : "";
  const { rows, total } = await queryPage<AccessControlContextRow>(db, {
    sql: `SELECT contexts.id, contexts.type, contexts.name
          FROM (
            SELECT e.id AS id, 'event' AS type, e.name AS name
              FROM events e
             WHERE ? = 'event'
            UNION ALL
            SELECT g.id AS id, 'group' AS type, g.name AS name
              FROM groups g
             WHERE ? = 'group'
            UNION ALL
            SELECT m.id AS id, 'organization' AS type, o.name AS name
              FROM members m
              JOIN organizations o ON o.id = m.organization_id
             WHERE ? = 'organization'
          ) AS contexts
          ${where}`,
    bindings: [query.contextType, query.contextType, query.contextType, ...(search?.bindings ?? [])],
    orderBy: resolveOrderBy(query.sort, ["name"], "ORDER BY contexts.name COLLATE NOCASE ASC", "contexts.id ASC"),
    limit: query.limit,
    offset: query.offset,
  });
  const contexts = rows.map((row) => accessControlContextSchema.parse(row));
  return { contexts, page: buildPageInfo(query.limit, query.offset, total, contexts.length) };
}
