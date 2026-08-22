import { buildPageInfo } from "../../../assets/shared/schemas/pagination";
import { ADMIN_AUDIT_LOG_SORT_COLUMNS } from "../../../assets/shared/schemas/admin-audit-log";
import type { AuditLogListQuery } from "../../../assets/shared/schemas/admin-audit-log";
import { queryPage } from "../db/pagination";
import { buildD1TextSearchFilter } from "../db/search";
import { resolveMappedOrderBy } from "../db/sort";
import type { DatabaseLike } from "../types";
import { parseJsonSafe } from "../utils/json";

interface AuditLogRow {
  id: string;
  actor_type: string;
  actor_id: string | null;
  actor_display: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details_json: string | null;
  created_at: string;
}

function buildAuditLogFilter(query: AuditLogListQuery): { where: string; bindings: unknown[] } {
  const clauses: string[] = [];
  const bindings: unknown[] = [];
  const exactFilters = [
    ["al.entity_type", query.entityType],
    ["al.actor_type", query.actorType],
    ["al.action", query.action],
    ["al.entity_id", query.entityId],
  ] as const;

  for (const [column, value] of exactFilters) {
    if (!value) continue;
    clauses.push(`${column} = ?`);
    bindings.push(value);
  }

  if (query.q) {
    const search = buildD1TextSearchFilter(query.q, [
      "al.action",
      "al.entity_id",
      "al.entity_type",
      "al.details_json",
      "u.email",
      "u.first_name",
      "u.last_name",
      "u.first_name || ' ' || u.last_name",
    ]);
    clauses.push(search.sql);
    bindings.push(...search.bindings);
  }

  return { where: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "", bindings };
}

export async function listAdminAuditLog(db: DatabaseLike, query: AuditLogListQuery) {
  const filter = buildAuditLogFilter(query);
  const orderBy = resolveMappedOrderBy(
    query.sort,
    {
      actor: "actor_display",
      action: "al.action",
      entity_type: "al.entity_type",
      created_at: "al.created_at",
    } satisfies Record<(typeof ADMIN_AUDIT_LOG_SORT_COLUMNS)[number], string>,
    "al.created_at DESC",
    "al.id ASC",
  );
  const baseJoin = `FROM audit_log al LEFT JOIN users u ON al.actor_type = 'admin' AND u.id = al.actor_id`;
  const { rows, total } = await queryPage<AuditLogRow>(db, {
    sql: `SELECT
         al.id,
         al.actor_type,
         al.actor_id,
         COALESCE(u.first_name || ' ' || u.last_name, u.first_name, u.email) AS actor_display,
         al.action,
         al.entity_type,
         al.entity_id,
         al.details_json,
         al.created_at
       ${baseJoin}
       ${filter.where}
       `,
    bindings: filter.bindings,
    orderBy,
    limit: query.limit,
    offset: query.offset,
  });

  const entries = rows.map(({ details_json: detailsJson, ...row }) => ({
    ...row,
    details: detailsJson ? parseJsonSafe<unknown>(detailsJson, null) : null,
  }));
  return {
    entries,
    page: buildPageInfo(query.limit, query.offset, total, entries.length),
  };
}
