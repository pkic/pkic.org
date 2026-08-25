import type { z } from "zod";
import { auditLogEntrySchema, auditLogFilterQueryShape } from "./audit-log";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";

/**
 * Allowlisted sort columns for GET /api/v1/admin/audit-log — see
 * functions/api/v1/admin/audit-log.ts. These are API-facing keys; the route
 * maps them to qualified SQL expressions so database aliases never leak into
 * the request contract.
 */
export const ADMIN_AUDIT_LOG_SORT_COLUMNS = ["actor", "action", "entity_type", "created_at"] as const;

export const auditLogListQuerySchema = listQuerySchema(ADMIN_AUDIT_LOG_SORT_COLUMNS).extend(auditLogFilterQueryShape);
export type AuditLogListQuery = z.infer<typeof auditLogListQuerySchema>;

export { auditLogEntrySchema } from "./audit-log";
export type { AuditLogEntry } from "./audit-log";
export const auditLogListResponseSchema = paginatedResponseSchema("entries", auditLogEntrySchema);

export const auditLogListRouteSchema = {
  tags: ["Audit log"],
  summary: "List global audit log entries (admin)",
  description:
    "Paginated, filterable view of the global audit log. `q` matches action, entity_id, actor_display, and details_json.",
  request: { query: auditLogListQuerySchema },
  responses: {
    "200": {
      description: "Audit log entries.",
      content: {
        "application/json": { schema: auditLogListResponseSchema },
      },
    },
  },
};
