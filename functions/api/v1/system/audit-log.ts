/**
 * GET /api/v1/system/audit-log
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
import { requireUserBackedAdminFromRequest } from "../../../_lib/auth/admin";
import { requirePermission } from "../../../_lib/auth/permissions";
import { requestDb, type AdminContext } from "../../../_lib/db/context";
import { openApiRoute } from "../../../_lib/openapi/route";
import { listSystemAuditLog } from "../../../_lib/services/system-audit-log";
import { systemAuditLogListRouteSchema } from "../../../../assets/shared/schemas/system-audit-log";

export const SystemAuditLogList = openApiRoute(systemAuditLogListRouteSchema, async (c: AdminContext, data) => {
  const staff = await requireUserBackedAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(staff, "audit:read");

  return json(await listSystemAuditLog(requestDb(c), data.query));
});
