import type { z } from "zod";
import { auditLogEntrySchema, auditLogFilterQueryShape } from "./audit-log";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";

/**
 * Allowlisted sort columns for GET /api/v1/system/audit-log. These are
 * API-facing keys; the route
 * maps them to qualified SQL expressions so database aliases never leak into
 * the request contract.
 */
export const SYSTEM_AUDIT_LOG_SORT_COLUMNS = ["actor", "action", "entity_type", "created_at"] as const;

export const systemAuditLogListQuerySchema =
  listQuerySchema(SYSTEM_AUDIT_LOG_SORT_COLUMNS).extend(auditLogFilterQueryShape);
export type SystemAuditLogListQuery = z.infer<typeof systemAuditLogListQuerySchema>;

export { auditLogEntrySchema } from "./audit-log";
export type { AuditLogEntry } from "./audit-log";
export const systemAuditLogListResponseSchema = paginatedResponseSchema("entries", auditLogEntrySchema);

export const systemAuditLogListRouteSchema = {
  tags: ["Audit log"],
  summary: "List global system audit log entries",
  description:
    "Permission-gated, paginated view of the global audit log. `q` matches action, entity_id, actor_display, and details_json.",
  request: { query: systemAuditLogListQuerySchema },
  responses: {
    "200": {
      description: "Audit log entries.",
      content: {
        "application/json": { schema: systemAuditLogListResponseSchema },
      },
    },
    "401": { description: "Portal staff authentication is required." },
    "403": { description: "The staff identity lacks audit:read." },
  },
};
