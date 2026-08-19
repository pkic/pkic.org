import { z } from "zod";
import { emailTemplateKeyParamsSchema } from "./api";
import { paginationQuerySchema, paginatedResponseSchema, sortColumnSchema } from "./pagination";

/**
 * Allowlisted sort columns for GET /api/v1/admin/email-templates — see
 * functions/api/v1/admin/email-templates.ts. `active_version`/`version_count`
 * are that query's own aggregate SELECT-list aliases (grouped by
 * `template_key`), not raw `email_template_versions` columns.
 */
export const ADMIN_EMAIL_TEMPLATES_SORT_COLUMNS = ["template_key", "active_version", "version_count"] as const;

export const emailTemplatesSortValueSchema = sortColumnSchema(ADMIN_EMAIL_TEMPLATES_SORT_COLUMNS);

/** Body format of a rendered email template/message. Canonical vocabulary — see AGENTS.md DRY policy. */
export const emailContentTypeSchema = z.enum(["markdown", "html", "text"]);
export type EmailContentType = z.infer<typeof emailContentTypeSchema>;

/** Delivery classification used for outbox rows and templates. Canonical vocabulary — see AGENTS.md DRY policy. */
export const emailMessageTypeSchema = z.enum(["transactional", "promotional"]);
export type EmailMessageType = z.infer<typeof emailMessageTypeSchema>;

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
  tags: ["Admin email templates"],
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

// ── Template version list ───────────────────────────────────────────────

/**
 * Mirrors every column of email_template_versions (migration 0000, plus
 * message_type from migration 0029) — GET .../:key/versions does
 * `SELECT * FROM email_template_versions WHERE template_key = ?`.
 */
export const adminEmailTemplateVersionRowSchema = z.object({
  id: z.string(),
  template_key: z.string(),
  version: z.number(),
  subject_template: z.string().nullable(),
  body: z.string().nullable(),
  content_type: z.string(),
  r2_object_key: z.string().nullable(),
  checksum_sha256: z.string(),
  status: z.string(),
  created_by_user_id: z.string().nullable(),
  created_at: z.string(),
  message_type: z.string(),
});

export const emailTemplateVersionsListRouteSchema = {
  tags: ["Admin email templates"],
  summary: "List a template's versions (admin)",
  description: "Paginated list of every version of a single template, newest version first.",
  request: {
    params: emailTemplateKeyParamsSchema,
    query: paginationQuerySchema,
  },
  responses: {
    "200": {
      description: "Template versions list.",
      content: {
        "application/json": { schema: paginatedResponseSchema("versions", adminEmailTemplateVersionRowSchema) },
      },
    },
  },
};
