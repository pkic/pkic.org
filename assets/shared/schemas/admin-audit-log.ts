import { z } from "zod";
import { auditLogEntrySchema } from "./audit-log";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";

/**
 * Allowlisted sort columns for GET /api/v1/admin/audit-log — see
 * functions/api/v1/admin/audit-log.ts. These are API-facing keys; the route
 * maps them to qualified SQL expressions so database aliases never leak into
 * the request contract.
 */
export const ADMIN_AUDIT_LOG_SORT_COLUMNS = ["actor", "action", "entity_type", "created_at"] as const;

// Free-text filters here have no fixed vocabulary (entity_type/actor_type/
// action/entity_id are arbitrary application-defined strings, not an enum),
// so — unlike organizationsListQuerySchema's `q` — these are deliberately
// NOT `.min(1)`: chanfana normalizes an empty query value (`?entityType=`)
// to `null` before Zod ever sees it (coerceInputs in chanfana's
// parameters.ts), and the pre-Chanfana handler this replaces already
// treated a present-but-blank value the same as an absent one (trim, then a
// truthy check). `.min(1)` would turn that previously-accepted case into a
// 400. `.nullable()` lets both "absent" (undefined) and "present but blank"
// (null) through; the empty string produced by `.trim()` on a
// whitespace-only value is filtered out the same truthy way in the
// WHERE-clause builder.
function optionalFilterString(max: number) {
  return z.string().trim().max(max).nullable().optional();
}

export const auditLogListQuerySchema = listQuerySchema(ADMIN_AUDIT_LOG_SORT_COLUMNS).extend({
  entityType: optionalFilterString(200),
  actorType: optionalFilterString(200),
  action: optionalFilterString(200),
  entityId: optionalFilterString(200),
});
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
