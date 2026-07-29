import { z } from "zod";

/**
 * Allowlisted sort columns for GET /api/v1/admin/email-templates — see
 * functions/api/v1/admin/email-templates.ts. `active_version`/`version_count`
 * are that query's own aggregate SELECT-list aliases (grouped by
 * `template_key`), not raw `email_template_versions` columns.
 */
export const ADMIN_EMAIL_TEMPLATES_SORT_COLUMNS = ["template_key", "active_version", "version_count"] as const;

export const emailTemplatesSortValueSchema = z
  .string()
  .trim()
  .min(1)
  .max(41)
  .refine(
    (value) => {
      const field = value.startsWith("-") ? value.slice(1) : value;
      return (ADMIN_EMAIL_TEMPLATES_SORT_COLUMNS as readonly string[]).includes(field);
    },
    { message: "Unknown sort column" },
  )
  .optional();
