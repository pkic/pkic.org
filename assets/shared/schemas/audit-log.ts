import { z } from "zod";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import { requiresPermissions } from "./route-contract";

export const SCOPED_AUDIT_LOG_SORT_COLUMNS = ["createdAt", "action", "actor"] as const;

/**
 * Allowlisted sort columns for the platform-wide audit-log collection. These
 * API-facing keys map to qualified SQL expressions so database aliases never
 * leak into the request contract.
 */
export const AUDIT_LOG_SORT_COLUMNS = ["actor", "action", "entity_type", "created_at"] as const;

function optionalAuditFilterString(max: number) {
  return z.string().trim().max(max).nullable().optional();
}

/** Exact audit filters shared by global, entity-scoped, and group-scoped lists. */
export const auditLogFilterQueryShape = {
  entityType: optionalAuditFilterString(200),
  actorType: optionalAuditFilterString(200),
  action: optionalAuditFilterString(200),
  entityId: optionalAuditFilterString(200),
};

export const scopedAuditLogListQuerySchema =
  listQuerySchema(SCOPED_AUDIT_LOG_SORT_COLUMNS).extend(auditLogFilterQueryShape);
export type ScopedAuditLogListQuery = z.infer<typeof scopedAuditLogListQuerySchema>;

export const auditLogListQuerySchema = listQuerySchema(AUDIT_LOG_SORT_COLUMNS).extend(auditLogFilterQueryShape);
export type AuditLogListQuery = z.infer<typeof auditLogListQuerySchema>;

/** Canonical transport shape shared by global and entity-scoped audit lists. */
export const auditLogEntrySchema = z.object({
  id: z.string(),
  actor_type: z.string(),
  actor_id: z.string().nullable(),
  actor_display: z.string().nullable(),
  action: z.string(),
  entity_type: z.string(),
  entity_id: z.string().nullable(),
  details: z.record(z.string(), z.unknown()).nullable(),
  created_at: z.string(),
});

export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;

export const scopedAuditLogResponseSchema = paginatedResponseSchema("auditLog", auditLogEntrySchema);
export type ScopedAuditLogResponse = z.infer<typeof scopedAuditLogResponseSchema>;

export const auditLogListResponseSchema = paginatedResponseSchema("entries", auditLogEntrySchema);
export type AuditLogListResponse = z.infer<typeof auditLogListResponseSchema>;

export const auditLogListRouteSchema = {
  ...requiresPermissions("audit:read"),
  tags: ["Audit log"],
  summary: "List platform-wide audit log entries",
  description:
    "Permission-gated, paginated view of the platform audit log. `q` matches action, entity_id, actor_display, and details_json.",
  request: { query: auditLogListQuerySchema },
  responses: {
    "200": {
      description: "Audit log entries.",
      content: {
        "application/json": { schema: auditLogListResponseSchema },
      },
    },
    "401": { description: "Portal staff authentication is required." },
    "403": { description: "The staff identity lacks audit:read." },
  },
};
