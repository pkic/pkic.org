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
import type { AdminContext } from "../../../_lib/db/context";
import { openApiRoute } from "../../../_lib/openapi/route";
import { listSystemAuditLog } from "../../../_lib/services/system-audit-log";
import { systemAuditLogListRouteSchema } from "../../../../assets/shared/schemas/system-audit-log";
import { requireSystemPermission } from "./authorization";

export const SystemAuditLogList = openApiRoute(systemAuditLogListRouteSchema, async (c: AdminContext, data) => {
  const { db } = await requireSystemPermission(c, "audit:read");

  return json(await listSystemAuditLog(db, data.query));
});
