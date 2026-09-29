/**
 * GET /api/v1/audit-log
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
import type { AdminContext } from "../../../_lib/db/context";
import { openApiRoute } from "../../../_lib/openapi/route";
import { listGlobalAuditLog } from "../../../_lib/services/audit-log-read";
import { auditLogListRouteSchema } from "../../../../assets/shared/schemas/audit-log";
import { requireStaffPermission } from "../../../_lib/auth/staff-permissions";

export const AuditLogList = openApiRoute(auditLogListRouteSchema, async (c: AdminContext, data) => {
  const { db } = await requireStaffPermission(c, "audit:read");

  return json(await listGlobalAuditLog(db, data.query));
});
