import { z } from "zod";
import { booleanQueryFlagSchema, emailMessageTypeSchema, successResponseSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";

export const emailOutboxStatusSchema = z.enum([
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

export const EMAIL_OUTBOX_SORT_COLUMNS = ["recipient", "template", "status", "sendAfter", "createdAt"] as const;

export const emailOutboxQuerySchema = listQuerySchema(EMAIL_OUTBOX_SORT_COLUMNS).extend({
  status: emailOutboxStatusSchema.optional(),
  messageType: emailMessageTypeSchema.optional(),
  dueNow: booleanQueryFlagSchema.default(false),
});
export type EmailOutboxQuery = z.infer<typeof emailOutboxQuerySchema>;

export const emailOutboxProcessSchema = z.object({
  limit: z.number().int().positive().max(500).default(20),
  ids: z.array(databaseIdSchema).min(1).max(100).optional(),
});

export const emailOutboxResetFailedSchema = z.object({
  ids: z.array(databaseIdSchema).min(1).max(100),
});

export const emailOutboxProcessResponseSchema = successResponseSchema.extend({
  processed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative().optional(),
});

export const emailOutboxResetFailedResponseSchema = successResponseSchema.extend({
  reset: z.number().int().nonnegative(),
  processed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});
export type EmailOutboxProcessResponse = z.infer<typeof emailOutboxProcessResponseSchema>;
export type EmailOutboxResetFailedResponse = z.infer<typeof emailOutboxResetFailedResponseSchema>;

export const emailOutboxRowSchema = z.object({
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
  status: emailOutboxStatusSchema,
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

export const emailOutboxResponseSchema = paginatedResponseSchema("outbox", emailOutboxRowSchema).extend({
  summary: z.object({
    total: z.number().int().nonnegative(),
    byStatus: z.partialRecord(emailOutboxStatusSchema, z.number().int().nonnegative()),
    byMessageType: z.partialRecord(emailMessageTypeSchema, z.number().int().nonnegative()),
    topTemplates: z.array(z.object({ template_key: z.string(), count: z.number().int().nonnegative() })),
    dueNow: z.number().int().nonnegative(),
    dueByStatus: z.partialRecord(emailOutboxStatusSchema, z.number().int().nonnegative()),
    nextSendAfter: z.string().nullable(),
  }),
});

export type EmailOutboxRow = z.infer<typeof emailOutboxRowSchema>;
export type EmailOutboxResponse = z.infer<typeof emailOutboxResponseSchema>;
export type EmailOutboxStatus = z.infer<typeof emailOutboxStatusSchema>;

export const emailOutboxProcessRouteSchema = {
  tags: ["Email"],
  "x-pkic-auth": { required: true, scopes: ["email:read", "email:manage"] },
  summary: "Process a bounded email-outbox selection",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: emailOutboxProcessSchema } },
    },
  },
  responses: {
    "200": {
      description: "Bounded outbox processing result.",
      content: { "application/json": { schema: emailOutboxProcessResponseSchema } },
    },
    "401": { description: "Staff session required." },
    "403": { description: "email:read and email:manage permissions required." },
    "409": { description: "Authorization changed while processing." },
  },
};

export const emailOutboxResetFailedRouteSchema = {
  tags: ["Email"],
  "x-pkic-auth": { required: true, scopes: ["email:read", "email:manage"] },
  summary: "Reset and process selected failed email-outbox rows",
  description:
    "Resets only the explicitly selected, bounded failed or delivery-unknown rows and processes exactly the rows that were changed. Unrelated due messages are never selected by this command.",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: emailOutboxResetFailedSchema } },
    },
  },
  responses: {
    "200": {
      description: "Selected reset and processing result.",
      content: { "application/json": { schema: emailOutboxResetFailedResponseSchema } },
    },
    "401": { description: "Staff session required." },
    "403": { description: "email:read and email:manage permissions required." },
    "409": { description: "Authorization changed while processing." },
  },
};
