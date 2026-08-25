import { z } from "zod";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";

export const SCOPED_AUDIT_LOG_SORT_COLUMNS = ["createdAt", "action", "actor"] as const;

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
