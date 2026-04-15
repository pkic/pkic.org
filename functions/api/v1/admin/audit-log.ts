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
import { all, first } from "../../../_lib/db/queries";
import type { DatabaseLike } from "../../../_lib/types";

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

interface CountRow {
  total: number;
}

function buildQuery(
  q: string,
  entityType: string,
  actorType: string,
  action: string,
  entityId: string,
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
    clauses.push(
      "(al.action LIKE ? OR al.entity_id LIKE ? OR al.entity_type LIKE ? OR al.details_json LIKE ? OR COALESCE(u.first_name || ' ' || u.last_name, u.first_name, u.email) LIKE ?)",
    );
    const pattern = `%${q}%`;
    params.push(pattern, pattern, pattern, pattern, pattern);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  return { where, params };
}

export async function onRequestGet(c: any): Promise<Response> {
  await requireAdminFromRequest(c.env.DB, c.req.raw, c.env);

  const url = new URL(c.req.raw.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 200);
  const offset = Math.max(0, parseInt(url.searchParams.get("offset") ?? "0", 10) || 0);
  const q = (url.searchParams.get("q") ?? "").trim();
  const entityType = (url.searchParams.get("entityType") ?? "").trim();
  const actorType = (url.searchParams.get("actorType") ?? "").trim();
  const action = (url.searchParams.get("action") ?? "").trim();
  const entityId = (url.searchParams.get("entityId") ?? "").trim();

  const db: DatabaseLike = c.env.DB;
  const { where, params } = buildQuery(q, entityType, actorType, action, entityId);

  const baseJoin = `FROM audit_log al LEFT JOIN users u ON al.actor_type = 'admin' AND u.id = al.actor_id`;

  const [countRow, rows] = await Promise.all([
    first<CountRow>(db, `SELECT COUNT(*) AS total ${baseJoin} ${where}`, params),
    all<AuditLogRow>(
      db,
      `SELECT
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
       ORDER BY al.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    ),
  ]);

  const total = countRow?.total ?? 0;
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
    page: { limit, offset, total, hasMore: offset + rows.length < total },
  });
}
