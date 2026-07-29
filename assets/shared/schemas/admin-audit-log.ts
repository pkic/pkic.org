import { z } from "zod";

/**
 * Allowlisted sort columns for GET /api/v1/admin/audit-log — see
 * functions/api/v1/admin/audit-log.ts. Table-qualified (`al.`) where the
 * column name would otherwise collide with the LEFT JOINed `users` table's
 * own `created_at`; `actor_display` is the query's own COALESCE(...) alias.
 */
export const ADMIN_AUDIT_LOG_SORT_COLUMNS = ["actor_display", "al.action", "al.entity_type", "al.created_at"] as const;

export const auditLogSortValueSchema = z
  .string()
  .trim()
  .min(1)
  .max(41)
  .refine(
    (value) => {
      const field = value.startsWith("-") ? value.slice(1) : value;
      return (ADMIN_AUDIT_LOG_SORT_COLUMNS as readonly string[]).includes(field);
    },
    { message: "Unknown sort column" },
  )
  .optional();
