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
 * Allowlisted sort columns for GET /api/v1/system/email-templates.
 * `active_version`/`version_count`
 * are that query's own aggregate SELECT-list aliases (grouped by
 * `template_key`), not raw `email_template_versions` columns.
 */
export const EMAIL_TEMPLATES_SORT_COLUMNS = ["template_key", "active_version", "version_count"] as const;

const emailTemplateReadAuthorizationResponses = {
  "401": { description: "Staff authentication required." },
  "403": { description: "Email-template read permission required." },
} as const;

const emailTemplateWriteAuthorizationResponses = {
  "401": { description: "Staff authentication required." },
  "403": { description: "Email-template write permission required." },
} as const;

export const emailTemplatesSortValueSchema = sortColumnSchema(EMAIL_TEMPLATES_SORT_COLUMNS);

// ── Template list ────────────────────────────────────────────────────────

export const emailTemplateSummarySchema = z.object({
  template_key: z.string(),
  active_version: z.number().nullable(),
  version_count: z.number(),
  draft_count: z.number(),
});
export type EmailTemplateSummary = z.infer<typeof emailTemplateSummarySchema>;

export const emailTemplatesListResponseSchema = paginatedResponseSchema("templates", emailTemplateSummarySchema);

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
  tags: ["System email templates"],
  summary: "List email templates",
  "x-pkic-auth": { required: true, scopes: ["email-templates:read"] },
  description:
    "Paginated, optionally key-filtered list of every email template, one row per template_key aggregating its versions.",
  request: { query: emailTemplatesListQuerySchema },
  responses: {
    "200": {
      description: "Email templates list.",
      content: {
        "application/json": { schema: emailTemplatesListResponseSchema },
      },
    },
    "400": { description: "Invalid list query." },
    ...emailTemplateReadAuthorizationResponses,
  },
};

export const emailTemplateVersionSchema = z.object({
  content: z.string().min(1).max(500_000),
  subjectTemplate: z.string().trim().min(1).max(512).optional(),
  contentType: emailContentTypeSchema.optional(),
  messageType: emailMessageTypeSchema.optional(),
});
export type EmailTemplateVersionInput = z.infer<typeof emailTemplateVersionSchema>;

/** Lifecycle states persisted by email_template_versions. */
export const emailTemplateVersionStatusSchema = z.enum(["draft", "active", "archived"]);
export type EmailTemplateVersionStatus = z.infer<typeof emailTemplateVersionStatusSchema>;

export const emailTemplateActivateSchema = z.object({
  version: z.number().int().positive(),
});

export const EMAIL_TEMPLATE_PREVIEW_MAX_COLLECTION_ITEMS = 1_000;
export const EMAIL_TEMPLATE_PREVIEW_MAX_DATA_NODES = 10_000;
export const EMAIL_TEMPLATE_PREVIEW_MAX_DATA_DEPTH = 16;

const emailTemplatePreviewDataSchema = z
  .record(z.string().trim().min(1).max(80), z.unknown())
  .superRefine((data, context) => {
    const pending: Array<{ value: unknown; depth: number }> = [{ value: data, depth: 0 }];
    let nodes = 0;

    while (pending.length > 0) {
      const current = pending.pop()!;
      nodes++;
      if (nodes > EMAIL_TEMPLATE_PREVIEW_MAX_DATA_NODES) {
        context.addIssue({ code: "custom", message: "Preview data is too complex" });
        return;
      }
      if (current.depth > EMAIL_TEMPLATE_PREVIEW_MAX_DATA_DEPTH) {
        context.addIssue({ code: "custom", message: "Preview data is nested too deeply" });
        return;
      }
      if (Array.isArray(current.value)) {
        if (current.value.length > EMAIL_TEMPLATE_PREVIEW_MAX_COLLECTION_ITEMS) {
          context.addIssue({ code: "custom", message: "Preview data collection is too large" });
          return;
        }
        for (const value of current.value) pending.push({ value, depth: current.depth + 1 });
      } else if (current.value !== null && typeof current.value === "object") {
        const values = Object.values(current.value);
        if (values.length > EMAIL_TEMPLATE_PREVIEW_MAX_COLLECTION_ITEMS) {
          context.addIssue({ code: "custom", message: "Preview data object is too large" });
          return;
        }
        for (const value of values) pending.push({ value, depth: current.depth + 1 });
      }
    }
  });

export const emailTemplatePreviewSchema = z.object({
  subjectTemplate: z.string().trim().min(1).max(512).optional(),
  content: z.string().min(1).max(500_000),
  contentType: emailContentTypeSchema.default("markdown"),
  layoutHtml: z.string().min(1).max(500_000).optional(),
  data: emailTemplatePreviewDataSchema.optional(),
});
export const emailTemplateExistsResponseSchema = z.object({ exists: z.boolean() });

export const emailTemplateExistsRouteSchema = {
  tags: ["System email templates"],
  summary: "Check whether an email template exists",
  "x-pkic-auth": { required: true, scopes: ["email-templates:read"] },
  request: { params: emailTemplateKeyParamsSchema },
  responses: {
    "200": {
      description: "Whether the template key exists.",
      content: { "application/json": { schema: emailTemplateExistsResponseSchema } },
    },
    "400": { description: "Invalid template key." },
    ...emailTemplateReadAuthorizationResponses,
  },
};
export const emailTemplateRenderedResponseSchema = z.object({
  subject: z.string(),
  html: z.string(),
  text: z.string(),
});
export const emailTemplatePreviewResponseSchema = successResponseSchema.extend({
  ...emailTemplateRenderedResponseSchema.shape,
  data: z.record(z.string(), z.unknown()),
});

export const emailTemplatePreviewRouteSchema = {
  tags: ["System email templates"],
  summary: "Render an email template preview",
  "x-pkic-auth": { required: true, scopes: ["email-templates:write"] },
  description: "Renders the supplied template using preview data and the configured email partials/layout.",
  request: {
    body: {
      content: { "application/json": { schema: emailTemplatePreviewSchema } },
      required: true,
    },
  },
  responses: {
    "200": {
      description: "Rendered email preview.",
      content: { "application/json": { schema: emailTemplatePreviewResponseSchema } },
    },
    "400": { description: "Invalid preview payload." },
    "422": { description: "Template expansion exceeds the safe rendering limit." },
    ...emailTemplateWriteAuthorizationResponses,
  },
};

// ── Template version list ───────────────────────────────────────────────

/**
 * Stable public projection of an email template version. Keep this explicit
 * rather than exposing every future database column through `SELECT *`.
 */
export const emailTemplateVersionRowSchema = z.object({
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
export const emailTemplateVersionCreateResponseSchema = successResponseSchema.extend({
  version: emailTemplateVersionRowSchema,
});

export type EmailTemplateVersion = z.infer<typeof emailTemplateVersionRowSchema>;

export const EMAIL_TEMPLATE_VERSIONS_SORT_COLUMNS = ["version", "status", "createdAt"] as const;

export const emailTemplateVersionsListQuerySchema = listQuerySchema(EMAIL_TEMPLATE_VERSIONS_SORT_COLUMNS).extend({
  status: emailTemplateVersionStatusSchema.optional(),
});
export type EmailTemplateVersionsListQuery = z.infer<typeof emailTemplateVersionsListQuerySchema>;
export const emailTemplateVersionsListResponseSchema = paginatedResponseSchema(
  "versions",
  emailTemplateVersionRowSchema,
);

export const emailTemplateVersionsListRouteSchema = {
  tags: ["System email templates"],
  summary: "List a template's versions",
  "x-pkic-auth": { required: true, scopes: ["email-templates:read"] },
  description: "Paginated list of every version of a single template, newest version first.",
  request: {
    params: emailTemplateKeyParamsSchema,
    query: emailTemplateVersionsListQuerySchema,
  },
  responses: {
    "200": {
      description: "Template versions list.",
      content: {
        "application/json": { schema: emailTemplateVersionsListResponseSchema },
      },
    },
    "400": { description: "Invalid template key or version-list query." },
    ...emailTemplateReadAuthorizationResponses,
  },
};

export const emailTemplateVersionCreateRouteSchema = {
  tags: ["System email templates"],
  summary: "Create a template version",
  "x-pkic-auth": { required: true, scopes: ["email-templates:write"] },
  description: "Creates a new draft version of a single email template.",
  request: {
    params: emailTemplateKeyParamsSchema,
    body: {
      content: { "application/json": { schema: emailTemplateVersionSchema } },
      required: true,
    },
  },
  responses: {
    "200": {
      description: "Template version created.",
      content: { "application/json": { schema: emailTemplateVersionCreateResponseSchema } },
    },
    "400": { description: "Invalid template key or version payload." },
    ...emailTemplateWriteAuthorizationResponses,
    "409": { description: "Template versions or authorization changed during creation." },
  },
};

export const emailTemplateActivateRouteSchema = {
  tags: ["System email templates"],
  summary: "Activate an email template version",
  "x-pkic-auth": { required: true, scopes: ["email-templates:write"] },
  description: "Marks a specific version as the only active version used for future rendering.",
  request: {
    params: emailTemplateKeyParamsSchema,
    body: {
      content: { "application/json": { schema: emailTemplateActivateSchema } },
      required: true,
    },
  },
  responses: {
    "200": {
      description: "Template version activated successfully.",
      content: { "application/json": { schema: successResponseSchema } },
    },
    "400": { description: "Invalid activation payload." },
    ...emailTemplateWriteAuthorizationResponses,
    "404": { description: "Template or version not found." },
    "409": { description: "Template state or authorization changed during activation." },
  },
};
