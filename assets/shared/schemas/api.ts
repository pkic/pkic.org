import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { linksSchema } from "./links";
import { listQuerySchema } from "./pagination";
import { emailContentTypeSchema, emailMessageTypeSchema, normalizedEmailSchema, tokenSchema } from "./api-common";

export { sourceTypeSchema } from "./source";
export * from "./api-common";
export * from "./registration";
export * from "./proposal-management";
export * from "./proposal-comments";
export * from "./admin-forms";
export * from "./admin-events";
export * from "./invites";
export * from "./images";
export * from "./participant-roles";
export * from "./calendar-rsvp";

export const ADMIN_EMAIL_OUTBOX_SORT_COLUMNS = ["recipient", "template", "status", "sendAfter", "createdAt"] as const;

export const adminEmailOutboxQuerySchema = listQuerySchema(ADMIN_EMAIL_OUTBOX_SORT_COLUMNS).extend({
  status: z.enum(["queued", "sending", "sent", "failed", "retrying", "bounced"]).optional(),
  messageType: emailMessageTypeSchema.optional(),
  dueNow: z.coerce.boolean().optional(),
});

export const adminEmailTemplateVersionSchema = z.object({
  content: z.string().min(1).max(500_000),
  subjectTemplate: z.string().trim().min(1).max(512).optional(),
  contentType: emailContentTypeSchema.optional(),
  messageType: emailMessageTypeSchema.optional(),
});

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

export const adminAuthRequestSchema = z.object({ email: normalizedEmailSchema });
export const adminAuthVerifySchema = z.object({ token: tokenSchema });

export const adminRetryOutboxSchema = z.object({
  limit: z.number().int().positive().max(500).default(20),
  ids: z.array(databaseIdSchema).max(100).optional(),
});

export const adminResetFailedOutboxSchema = z.object({
  ids: z.array(databaseIdSchema).max(100).optional(),
});

export const adminRunRemindersSchema = z.object({
  limit: z.number().int().positive().max(500).default(200),
  dryRun: z.boolean().default(false),
});

export const adminRunJobsSchema = z.object({
  reminderLimit: z.number().int().positive().max(500).default(120),
  outboxLimit: z.number().int().positive().max(500).default(120),
  runReminders: z.boolean().default(true),
  runRetention: z.boolean().default(true),
  runOutbox: z.boolean().default(true),
  runRetentionMode: z.enum(["always", "daily_window"]).default("always"),
  retentionHourUtc: z.number().int().min(0).max(23).default(3),
  dryRun: z.boolean().default(false),
  runConsultationBatch: z.boolean().default(false),
  runEcReviewBatch: z.boolean().default(false),
  runWgChairDigest: z.boolean().default(false),
});

export const speakerReminderPreferenceSchema = z.object({
  action: z.enum(["postpone_7d", "pause_30d", "resume"]),
});

export const adminRoleValueSchema = z.enum(["admin", "user", "guest"]);
export type AdminRoleValue = z.infer<typeof adminRoleValueSchema>;

export const adminUserRoleSchema = z.object({ role: adminRoleValueSchema });

export const adminUserUpdateSchema = z
  .object({
    role: adminRoleValueSchema.optional(),
    active: z.boolean().optional(),
    email: z.string().trim().toLowerCase().email().optional(),
    firstName: z.string().trim().max(80).nullable().optional(),
    lastName: z.string().trim().max(120).nullable().optional(),
    preferredName: z.string().trim().max(80).nullable().optional(),
    organizationName: z.string().trim().max(200).nullable().optional(),
    jobTitle: z.string().trim().max(200).nullable().optional(),
    biography: z.string().trim().max(5000).nullable().optional(),
    links: linksSchema.nullable().optional(),
    isEcMember: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: "At least one field must be provided",
  });

export const adminUserAnonymizeSchema = z.object({}).strict();
