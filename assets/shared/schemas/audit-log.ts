import { z } from "zod";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";

export const SCOPED_AUDIT_LOG_SORT_COLUMNS = ["createdAt", "action", "actor"] as const;
export const scopedAuditLogListQuerySchema = listQuerySchema(SCOPED_AUDIT_LOG_SORT_COLUMNS);
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
