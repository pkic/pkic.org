import { z } from "zod";
import { booleanQueryFlagSchema, emailMessageTypeSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";

export const adminEmailOutboxStatusSchema = z.enum([
  "queued",
  "sending",
  "sent",
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

export const adminRetryOutboxSchema = z.object({
  limit: z.number().int().positive().max(500).default(20),
  ids: z.array(databaseIdSchema).max(100).optional(),
});

export const adminResetFailedOutboxSchema = z.object({
  ids: z.array(databaseIdSchema).max(100).optional(),
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
    total: z.number(),
    byStatus: z.record(z.string(), z.number()),
    byMessageType: z.record(z.string(), z.number()),
    topTemplates: z.array(z.object({ template_key: z.string(), count: z.number() })),
    dueNow: z.number(),
    dueByStatus: z.record(z.string(), z.number()),
    nextSendAfter: z.string().nullable(),
  }),
});

export type AdminEmailOutboxRow = z.infer<typeof adminEmailOutboxRowSchema>;
export type AdminEmailOutboxResponse = z.infer<typeof adminEmailOutboxResponseSchema>;
