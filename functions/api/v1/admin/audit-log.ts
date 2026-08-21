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
import { requestDb, type AdminContext } from "../../../_lib/db/context";
import { openApiRoute } from "../../../_lib/openapi/route";
import { listAdminAuditLog } from "../../../_lib/services/admin-audit-log";
import { auditLogListRouteSchema } from "../../../../assets/shared/schemas/admin-audit-log";

export const AdminAuditLogList = openApiRoute(auditLogListRouteSchema, async (c: AdminContext, data) => {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);

  return json(
    await listAdminAuditLog(requestDb(c), {
      ...data.query,
      limit: data.query.limit ?? 50,
      offset: data.query.offset ?? 0,
    }),
  );
});
