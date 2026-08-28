import { z } from "zod";
import { booleanQueryFlagSchema, successResponseSchema } from "./api-common";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";

export const DUE_WORK_SORT_COLUMNS = ["dueAt", "title", "typeLabel"] as const;
export const dueWorkBucketSchema = z.enum(["all", "outbox", "reminders", "cleanup"]);

export const dueWorkListQuerySchema = listQuerySchema(DUE_WORK_SORT_COLUMNS, { limit: 25 }).extend({
  bucket: dueWorkBucketSchema.default("all"),
  includeRetention: booleanQueryFlagSchema.default(false),
  reminderLimit: z.coerce.number().int().min(1).max(500).default(120),
  outboxLimit: z.coerce.number().int().min(1).max(500).default(120),
  cleanupLimit: z.coerce.number().int().min(1).max(500).default(120),
});
export type DueWorkListQuery = z.infer<typeof dueWorkListQuerySchema>;

export const dueWorkRowSchema = z.object({
  bucket: dueWorkBucketSchema.exclude(["all"]),
  typeLabel: z.string(),
  title: z.string(),
  subtitle: z.string().nullable(),
  context: z.string(),
  detail: z.string().nullable(),
  dueAt: z.string().nullable(),
  statusKey: z.string(),
  statusLabel: z.string(),
});

export type DueWorkRow = z.infer<typeof dueWorkRowSchema>;
export type DueWorkTab = z.infer<typeof dueWorkBucketSchema>;

export const dueWorkCountsSchema = z.object({
  all: z.number(),
  outbox: z.number(),
  reminders: z.number(),
  cleanup: z.number(),
});

export const dueWorkListResponseSchema = paginatedResponseSchema("items", dueWorkRowSchema).extend({
  counts: dueWorkCountsSchema,
});

export type DueWorkListResponse = z.infer<typeof dueWorkListResponseSchema>;

export const dueWorkListRouteSchema = {
  tags: ["Operations"],
  "x-pkic-auth": { required: true, scopes: ["operations:read"] },
  summary: "List the bounded due-work batch",
  description:
    "Returns one server-owned, filterable/sortable/pageable projection of due outbox, reminder, and optional retention work. Each source has an explicit candidate limit so historical D1 data is not joined into an unbounded Worker read model; search and bucket counts describe that bounded preview batch rather than all historical due rows.",
  request: { query: dueWorkListQuerySchema },
  responses: {
    "200": {
      description: "Bounded due-work page and server-computed bucket counts.",
      content: { "application/json": { schema: dueWorkListResponseSchema } },
    },
    "401": { description: "Staff session required." },
    "403": { description: "operations:read permission required." },
  },
};

export const operationsReminderCommandSchema = z.object({
  limit: z.number().int().positive().max(500).default(200),
});

export const OPERATIONS_MEMBERSHIP_BATCH_KINDS = ["consultation", "ec-review", "wg-chair-digest"] as const;
export const operationsMembershipBatchKindSchema = z.enum(OPERATIONS_MEMBERSHIP_BATCH_KINDS);
export type OperationsMembershipBatchKind = z.infer<typeof operationsMembershipBatchKindSchema>;

export const operationsRetentionRunSchema = z.object({}).default({});

export const OPERATIONS_REMINDER_CATEGORIES = [
  "attendee_invite",
  "speaker_invite",
  "co_speaker_invite",
  "presentation_upload_request",
  "registration_confirmation",
] as const;

export const operationsReminderPreviewRowSchema = z.object({
  category: z.enum(OPERATIONS_REMINDER_CATEGORIES),
  templateKey: z.string(),
  eventName: z.string(),
  eventSlug: z.string(),
  recipientEmail: z.string(),
  recipientName: z.string().nullable(),
  proposalTitle: z.string().nullable(),
  reminderNumber: z.number(),
  dueAt: z.string().nullable(),
  subject: z.string(),
});

const reminderRows = (category: (typeof OPERATIONS_REMINDER_CATEGORIES)[number]) =>
  z.array(operationsReminderPreviewRowSchema.extend({ category: z.literal(category) }));

export const operationsRemindersRunResponseSchema = successResponseSchema.extend({
  dryRun: z.boolean(),
  inviteRemindersQueued: z.number(),
  speakerInviteRemindersQueued: z.number(),
  presentationRemindersQueued: z.number(),
  confirmationRemindersQueued: z.number(),
  confirmationCancellationsProcessed: z.number(),
  processed: z.number(),
  preview: z.object({
    attendeeInvites: reminderRows("attendee_invite"),
    speakerInvites: reminderRows("speaker_invite"),
    coSpeakerInvites: reminderRows("co_speaker_invite"),
    presentationUploads: reminderRows("presentation_upload_request"),
    registrationConfirmations: reminderRows("registration_confirmation"),
  }),
});

export const operationsRetentionRunResponseSchema = successResponseSchema.extend({
  redactedRegistrations: z.number(),
  redactedUsers: z.number(),
  affectedEvents: z.number(),
});

export const operationsMembershipBatchResponseSchema = successResponseSchema.extend({
  applicationsNotified: z.number().optional(),
  transitioned: z.number().optional(),
  workingGroupsWithChanges: z.number().optional(),
  emailsSent: z.number().optional(),
});
export type OperationsRemindersRunResponse = z.infer<typeof operationsRemindersRunResponseSchema>;
export type OperationsRetentionRunResponse = z.infer<typeof operationsRetentionRunResponseSchema>;
export type OperationsMembershipBatchResponse = z.infer<typeof operationsMembershipBatchResponseSchema>;

function commandBody(schema: z.ZodType) {
  return { required: true, content: { "application/json": { schema } } };
}

export const operationsRemindersPreviewRouteSchema = {
  tags: ["Operations"],
  "x-pkic-auth": { required: true, scopes: ["operations:read"] },
  summary: "Preview the bounded reminder command",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: operationsReminderCommandSchema } },
    },
  },
  responses: {
    "200": {
      description: "Reminder candidates without durable changes.",
      content: { "application/json": { schema: operationsRemindersRunResponseSchema } },
    },
    "401": { description: "Staff session required." },
    "403": { description: "operations:read permission required." },
  },
};

export const operationsRemindersRunRouteSchema = {
  tags: ["Operations"],
  "x-pkic-auth": { required: true, scopes: ["operations:read", "operations:run"] },
  summary: "Run one bounded reminder command",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: operationsReminderCommandSchema } },
    },
  },
  responses: {
    "200": {
      description: "Reminder intents queued by the bounded command.",
      content: { "application/json": { schema: operationsRemindersRunResponseSchema } },
    },
    "401": { description: "Staff session required." },
    "403": { description: "operations:read and operations:run permissions required." },
    "409": { description: "Authorization changed while the command was running." },
  },
};

export const operationsRetentionRunRouteSchema = {
  tags: ["Operations"],
  "x-pkic-auth": { required: true, scopes: ["operations:read", "operations:run", "users:anonymize"] },
  summary: "Run the retention command",
  request: { body: commandBody(operationsRetentionRunSchema) },
  responses: {
    "200": {
      description: "Retention redaction result.",
      content: { "application/json": { schema: operationsRetentionRunResponseSchema } },
    },
    "401": { description: "Staff session required." },
    "403": { description: "operations:read, operations:run, and users:anonymize permissions required." },
    "409": { description: "Authorization changed while the command was running." },
  },
};

function membershipBatchRouteSchema(
  summary: string,
  scopes: readonly ["operations:read", "operations:run", ...string[]],
) {
  return {
    tags: ["Operations"],
    "x-pkic-auth": { required: true, scopes },
    summary,
    request: { body: commandBody(z.object({}).default({})) },
    responses: {
      "200": {
        description: "Named membership-workflow result.",
        content: { "application/json": { schema: operationsMembershipBatchResponseSchema } },
      },
      "401": { description: "Staff session required." },
      "403": { description: "The exact operation and membership permissions are required." },
      "409": { description: "Authorization changed while the command was running." },
    },
  };
}

export const operationsConsultationBatchRunRouteSchema = membershipBatchRouteSchema(
  "Run the membership consultation-notification batch",
  ["operations:read", "operations:run", "membership:write"],
);
export const operationsEcReviewBatchRunRouteSchema = membershipBatchRouteSchema(
  "Run the membership EC-review transition batch",
  ["operations:read", "operations:run", "membership:approve"],
);
export const operationsWgChairDigestRunRouteSchema = membershipBatchRouteSchema(
  "Run the working-group chair digest batch",
  ["operations:read", "operations:run"],
);
