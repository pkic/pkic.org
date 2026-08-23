import { z } from "zod";
import {
  emailTemplateKeyParamsSchema,
  emailContentTypeSchema,
  emailMessageTypeSchema,
  successResponseSchema,
  type EmailContentType,
  type EmailMessageType,
} from "./api-common";
import { listQuerySchema, paginatedResponseSchema, searchableListQuerySchema, sortColumnSchema } from "./pagination";

export { emailContentTypeSchema, emailMessageTypeSchema };
export type { EmailContentType, EmailMessageType };

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
export type AdminEmailTemplateSummary = z.infer<typeof adminEmailTemplateSummarySchema>;

export const adminEmailTemplatesListResponseSchema = paginatedResponseSchema(
  "templates",
  adminEmailTemplateSummarySchema,
);

export const emailTemplatesListQuerySchema = searchableListQuerySchema(emailTemplatesSortValueSchema).extend({
  templateKeyPrefix: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z][a-z0-9_]*$/)
    .optional(),
});
export type EmailTemplatesListQuery = z.infer<typeof emailTemplatesListQuerySchema>;

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
        "application/json": { schema: adminEmailTemplatesListResponseSchema },
      },
    },
  },
};

export const adminEmailTemplateVersionSchema = z.object({
  content: z.string().min(1).max(500_000),
  subjectTemplate: z.string().trim().min(1).max(512).optional(),
  contentType: emailContentTypeSchema.optional(),
  messageType: emailMessageTypeSchema.optional(),
});
export type AdminEmailTemplateVersionInput = z.infer<typeof adminEmailTemplateVersionSchema>;

/** Lifecycle states persisted by email_template_versions. */
export const emailTemplateVersionStatusSchema = z.enum(["draft", "active", "archived"]);
export type EmailTemplateVersionStatus = z.infer<typeof emailTemplateVersionStatusSchema>;

export const adminEmailTemplateActivateSchema = z.object({
  version: z.number().int().positive(),
});

export const adminEmailTemplatePreviewSchema = z.object({
  subjectTemplate: z.string().trim().min(1).max(512).optional(),
  content: z.string().min(1).max(500_000),
  contentType: emailContentTypeSchema.default("markdown"),
  layoutHtml: z.string().min(1).max(500_000).optional(),
  data: z.record(z.string().trim().min(1).max(80), z.unknown()).optional(),
});
export const adminEmailTemplateExistsResponseSchema = z.object({ exists: z.boolean() });

export const emailTemplateExistsRouteSchema = {
  tags: ["Admin email templates"],
  summary: "Check whether an email template exists",
  request: { params: emailTemplateKeyParamsSchema },
  responses: {
    "200": {
      description: "Whether the template key exists.",
      content: { "application/json": { schema: adminEmailTemplateExistsResponseSchema } },
    },
    "400": { description: "Invalid template key." },
    "401": { description: "Admin authorization required." },
  },
};
export const adminEmailTemplateRenderedResponseSchema = z.object({
  subject: z.string(),
  html: z.string(),
  text: z.string(),
});
export const adminEmailTemplatePreviewResponseSchema = successResponseSchema.extend({
  ...adminEmailTemplateRenderedResponseSchema.shape,
  data: z.record(z.string(), z.unknown()),
});

export const adminEmailTemplatePreviewRouteSchema = {
  tags: ["Admin email templates"],
  summary: "Render an email template preview (admin)",
  description: "Renders the supplied template using preview data and the configured email partials/layout.",
  request: {
    body: {
      content: { "application/json": { schema: adminEmailTemplatePreviewSchema } },
      required: true,
    },
  },
  responses: {
    "200": {
      description: "Rendered email preview.",
      content: { "application/json": { schema: adminEmailTemplatePreviewResponseSchema } },
    },
  },
};

// ── Template version list ───────────────────────────────────────────────

/**
 * Stable public projection of an email template version. Keep this explicit
 * rather than exposing every future database column through `SELECT *`.
 */
export const adminEmailTemplateVersionRowSchema = z.object({
  id: z.string(),
  template_key: z.string(),
  version: z.number(),
  subject_template: z.string().nullable(),
  body: z.string().nullable(),
  content_type: emailContentTypeSchema,
  r2_object_key: z.string().nullable(),
  checksum_sha256: z.string(),
  status: emailTemplateVersionStatusSchema,
  created_by_user_id: z.string().nullable(),
  created_at: z.string(),
  message_type: emailMessageTypeSchema,
});
export const adminEmailTemplateVersionCreateResponseSchema = successResponseSchema.extend({
  version: adminEmailTemplateVersionRowSchema,
});
export const adminEmailTemplateVersionUpdateResponseSchema = adminEmailTemplateVersionCreateResponseSchema;

export type AdminEmailTemplateVersion = z.infer<typeof adminEmailTemplateVersionRowSchema>;

export const ADMIN_EMAIL_TEMPLATE_VERSIONS_SORT_COLUMNS = ["version", "status", "createdAt"] as const;

export const emailTemplateVersionsListQuerySchema = listQuerySchema(ADMIN_EMAIL_TEMPLATE_VERSIONS_SORT_COLUMNS).extend({
  status: emailTemplateVersionStatusSchema.optional(),
});
export type EmailTemplateVersionsListQuery = z.infer<typeof emailTemplateVersionsListQuerySchema>;
export const adminEmailTemplateVersionsListResponseSchema = paginatedResponseSchema(
  "versions",
  adminEmailTemplateVersionRowSchema,
);

export const emailTemplateVersionsListRouteSchema = {
  tags: ["Admin email templates"],
  summary: "List a template's versions (admin)",
  description: "Paginated list of every version of a single template, newest version first.",
  request: {
    params: emailTemplateKeyParamsSchema,
    query: emailTemplateVersionsListQuerySchema,
  },
  responses: {
    "200": {
      description: "Template versions list.",
      content: {
        "application/json": { schema: adminEmailTemplateVersionsListResponseSchema },
      },
    },
  },
};

export const emailTemplateVersionCreateRouteSchema = {
  tags: ["Admin email templates"],
  summary: "Create a template version (admin)",
  description: "Creates a new draft version of a single email template.",
  request: {
    params: emailTemplateKeyParamsSchema,
    body: {
      content: { "application/json": { schema: adminEmailTemplateVersionSchema } },
      required: true,
    },
  },
  responses: {
    "200": {
      description: "Template version created.",
      content: { "application/json": { schema: adminEmailTemplateVersionCreateResponseSchema } },
    },
  },
};
