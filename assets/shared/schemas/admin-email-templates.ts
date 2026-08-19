import { z } from "zod";
import { sortColumnSchema } from "./pagination";

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
