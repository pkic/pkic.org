import { z } from "zod";
import { paginationQuerySchema, paginatedResponseSchema, sortColumnSchema } from "./pagination";

/**
 * Allowlisted sort columns for GET /api/v1/admin/email-templates — see
 * functions/api/v1/admin/email-templates.ts. `active_version`/`version_count`
 * are that query's own aggregate SELECT-list aliases (grouped by
 * `template_key`), not raw `email_template_versions` columns.
 */
export const ADMIN_EMAIL_TEMPLATES_SORT_COLUMNS = ["template_key", "active_version", "version_count"] as const;

export const emailTemplatesSortValueSchema = sortColumnSchema(ADMIN_EMAIL_TEMPLATES_SORT_COLUMNS);

// ── Template list ────────────────────────────────────────────────────────

export const adminEmailTemplateSummarySchema = z.object({
  template_key: z.string(),
  active_version: z.number().nullable(),
  version_count: z.number(),
  draft_count: z.number(),
});

export const emailTemplatesListQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().min(1).max(200).optional(),
  sort: emailTemplatesSortValueSchema,
});

export const emailTemplatesListRouteSchema = {
  tags: ["Email templates"],
  summary: "List email templates (admin)",
  description:
    "Paginated, optionally key-filtered list of every email template, one row per template_key aggregating its versions.",
  request: { query: emailTemplatesListQuerySchema },
  responses: {
    "200": {
      description: "Email templates list.",
      content: {
        "application/json": { schema: paginatedResponseSchema("templates", adminEmailTemplateSummarySchema) },
      },
    },
  },
};
