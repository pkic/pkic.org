/**
 * GET /api/v1/admin/audit-log
 *
 * Returns a paginated, filterable view of the global audit log.
 *
 * Query params:
 *   limit       — rows per page (default 50, max 200)
 *   offset      — pagination offset (default 0)
 *   q           — free-text search (matches action, entity_id, actor_display, details_json)
 *   entityType  — filter by entity_type (e.g. "registration", "event", "user")
 *   actorType   — filter by actor_type (e.g. "admin", "system", "user")
 *   action      — filter by exact action string
 *   entityId    — filter by exact entity_id
 */
import { json } from "../../../_lib/http";
import { requireAdminFromRequest } from "../../../_lib/auth/admin";
import { queryPage } from "../../../_lib/db/pagination";
import { buildD1TextSearchFilter } from "../../../_lib/db/search";
import { resolveMappedOrderBy } from "../../../_lib/db/sort";
import type { DatabaseLike } from "../../../_lib/types";
import { requestDb, type AdminContext } from "../../../_lib/db/context";
import { openApiRoute } from "../../../_lib/openapi/route";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import {
  ADMIN_AUDIT_LOG_SORT_COLUMNS,
  auditLogListRouteSchema,
} from "../../../../assets/shared/schemas/admin-audit-log";

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

function buildQuery(
  q: string | null | undefined,
  entityType: string | null | undefined,
  actorType: string | null | undefined,
  action: string | null | undefined,
  entityId: string | null | undefined,
): { where: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (entityType) {
    clauses.push("al.entity_type = ?");
    params.push(entityType);
  }
  if (actorType) {
    clauses.push("al.actor_type = ?");
    params.push(actorType);
  }
  if (action) {
    clauses.push("al.action = ?");
    params.push(action);
  }
  if (entityId) {
    clauses.push("al.entity_id = ?");
    params.push(entityId);
  }
  if (q) {
    const search = buildD1TextSearchFilter(q, [
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
    params.push(...search.bindings);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  return { where, params };
}

export const AdminAuditLogList = openApiRoute(auditLogListRouteSchema, async (c: AdminContext, data) => {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);

  const { q, entityType, actorType, action, entityId, sort, limit = 50, offset = 0 } = data.query;

  const db: DatabaseLike = requestDb(c);
  const { where, params } = buildQuery(q, entityType, actorType, action, entityId);
  const orderBy = resolveMappedOrderBy(
    sort,
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

  const { rows, total } = await queryPage<AuditLogRow>(
    db,
    {
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
       ${where}
       ${orderBy}
       LIMIT ? OFFSET ?`,
      bindings: [...params, limit, offset],
    },
    { sql: `SELECT COUNT(*) AS total ${baseJoin} ${where}`, bindings: params },
  );
  const entries = rows.map((e) => ({
    ...e,
    details: e.details_json
      ? (() => {
          try {
            return JSON.parse(e.details_json);
          } catch {
            return null;
          }
        })()
      : null,
    details_json: undefined,
  }));

  return json({
    entries,
    page: buildPageInfo(limit, offset, total, rows.length),
  });
});
