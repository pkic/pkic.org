import { z } from "zod";
import { successResponseSchema } from "./api-common";

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

export const ADMIN_REMINDER_CATEGORIES = [
  "attendee_invite",
  "speaker_invite",
  "co_speaker_invite",
  "presentation_upload_request",
  "registration_confirmation",
] as const;

export const adminReminderPreviewRowSchema = z.object({
  category: z.enum(ADMIN_REMINDER_CATEGORIES),
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

const reminderRows = (category: (typeof ADMIN_REMINDER_CATEGORIES)[number]) =>
  z.array(adminReminderPreviewRowSchema.extend({ category: z.literal(category) }));

export const adminJobsRunResponseSchema = successResponseSchema.extend({
  dryRun: z.boolean(),
  reminders: z.object({
    processed: z.number(),
    inviteRemindersQueued: z.number(),
    speakerInviteRemindersQueued: z.number(),
    presentationRemindersQueued: z.number(),
    confirmationRemindersQueued: z.number(),
    confirmationCancellationsProcessed: z.number(),
    preview: z.object({
      attendeeInvites: reminderRows("attendee_invite"),
      speakerInvites: reminderRows("speaker_invite"),
      coSpeakerInvites: reminderRows("co_speaker_invite"),
      presentationUploads: reminderRows("presentation_upload_request"),
      registrationConfirmations: reminderRows("registration_confirmation"),
    }),
  }),
  shouldRunRetention: z.boolean(),
  retention: z.object({
    redactedRegistrations: z.number(),
    redactedUsers: z.number(),
    affectedEvents: z.number(),
    preview: z.object({
      dueEvents: z.array(
        z.object({
          eventId: z.string(),
          eventName: z.string(),
          eventSlug: z.string(),
          endsAt: z.string().nullable(),
          retentionDays: z.number(),
          eligibleRegistrations: z.number(),
          eligibleUsers: z.number(),
        }),
      ),
      totalEvents: z.number(),
      totalRegistrations: z.number(),
      totalUsers: z.number(),
    }),
  }),
  outbox: z.object({
    processed: z.number(),
    failed: z.number(),
    dueNow: z.number(),
    dueByStatus: z.record(z.string(), z.number()),
    nextSendAfter: z.string().nullable(),
  }),
  consultationBatch: z.object({ applicationsNotified: z.number() }),
  ecReviewBatch: z.object({ transitioned: z.number() }),
  wgChairDigest: z.object({ workingGroupsWithChanges: z.number(), emailsSent: z.number() }),
});

export type AdminReminderPreviewRow = z.infer<typeof adminReminderPreviewRowSchema>;
export type AdminJobsRunResponse = z.infer<typeof adminJobsRunResponseSchema>;
