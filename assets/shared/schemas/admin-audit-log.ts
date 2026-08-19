import { sortColumnSchema } from "./pagination";

/**
 * Allowlisted sort columns for GET /api/v1/admin/audit-log — see
 * functions/api/v1/admin/audit-log.ts. Table-qualified (`al.`) where the
 * column name would otherwise collide with the LEFT JOINed `users` table's
 * own `created_at`; `actor_display` is the query's own COALESCE(...) alias.
 */
export const ADMIN_AUDIT_LOG_SORT_COLUMNS = ["actor_display", "al.action", "al.entity_type", "al.created_at"] as const;

export const auditLogSortValueSchema = sortColumnSchema(ADMIN_AUDIT_LOG_SORT_COLUMNS);
