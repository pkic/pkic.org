import { z } from "zod";
import { booleanQueryFlagSchema, emailMessageTypeSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";

export const adminEmailOutboxStatusSchema = z.enum([
  "queued",
  "sending",
  "sent",
  "delivered",
  "delivery_unknown",
  "failed",
  "retrying",
  "bounced",
  "cancelled",
]);

export const ADMIN_EMAIL_OUTBOX_SORT_COLUMNS = ["recipient", "template", "status", "sendAfter", "createdAt"] as const;

export const adminEmailOutboxQuerySchema = listQuerySchema(ADMIN_EMAIL_OUTBOX_SORT_COLUMNS).extend({
  status: adminEmailOutboxStatusSchema.optional(),
  messageType: emailMessageTypeSchema.optional(),
  dueNow: booleanQueryFlagSchema.default(false),
});
export type AdminEmailOutboxQuery = z.infer<typeof adminEmailOutboxQuerySchema>;

export const adminRetryOutboxSchema = z.object({
  limit: z.number().int().positive().max(500).default(20),
  ids: z.array(databaseIdSchema).max(100).optional(),
});

export const adminResetFailedOutboxSchema = z.object({
  ids: z.array(databaseIdSchema).max(100).optional(),
});

export const adminRetryOutboxResponseSchema = z.object({
  processed: z.number().optional(),
  failed: z.number().optional(),
  skipped: z.number().optional(),
});

export const adminResetFailedOutboxResponseSchema = z.object({
  reset: z.number().optional(),
  processed: z.number().optional(),
});

export const adminEmailOutboxRowSchema = z.object({
  id: databaseIdSchema,
  eventSlug: z.string().nullable(),
  eventName: z.string().nullable(),
  templateKey: z.string(),
  templateVersion: z.number().nullable(),
  recipientEmail: z.string(),
  recipientName: z.string().nullable(),
  subject: z.string(),
  messageType: emailMessageTypeSchema,
  provider: z.string(),
  providerMessageId: z.string().nullable(),
  status: adminEmailOutboxStatusSchema,
  attempts: z.number(),
  sendAfter: z.string(),
  lastError: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  sentAt: z.string().nullable(),
  bccRecipientCount: z.number(),
  hasCalendarInvite: z.boolean(),
  hasBadgeAttachment: z.boolean(),
  usesDirectBody: z.boolean(),
  hasCustomText: z.boolean(),
});

export const adminEmailOutboxResponseSchema = paginatedResponseSchema("outbox", adminEmailOutboxRowSchema).extend({
  summary: z.object({
    total: z.number().int().nonnegative(),
    byStatus: z.partialRecord(adminEmailOutboxStatusSchema, z.number().int().nonnegative()),
    byMessageType: z.partialRecord(emailMessageTypeSchema, z.number().int().nonnegative()),
    topTemplates: z.array(z.object({ template_key: z.string(), count: z.number().int().nonnegative() })),
    dueNow: z.number().int().nonnegative(),
    dueByStatus: z.partialRecord(adminEmailOutboxStatusSchema, z.number().int().nonnegative()),
    nextSendAfter: z.string().nullable(),
  }),
});

export type AdminEmailOutboxRow = z.infer<typeof adminEmailOutboxRowSchema>;
export type AdminEmailOutboxResponse = z.infer<typeof adminEmailOutboxResponseSchema>;
export type AdminEmailOutboxStatus = z.infer<typeof adminEmailOutboxStatusSchema>;
