import { z } from "zod";
import { jsonErrorResponse, successResponseSchema } from "./api-common";

/**
 * Reminder cycles are an email-domain producer: every reminder they resolve is
 * queued into the durable outbox, which is why they live beside the outbox
 * rather than in a separate operations family.
 */
export const REMINDER_CATEGORIES = [
  "attendee_invite",
  "speaker_invite",
  "co_speaker_invite",
  "presentation_upload_request",
  "registration_confirmation",
] as const;
export const reminderCategorySchema = z.enum(REMINDER_CATEGORIES);

export const reminderPreviewRowSchema = z.object({
  category: reminderCategorySchema,
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

const reminderRows = (category: (typeof REMINDER_CATEGORIES)[number]) =>
  z.array(reminderPreviewRowSchema.extend({ category: z.literal(category) }));

/** A run is created rather than invoked, so `preview` and `execute` share one route. */
export const REMINDER_RUN_MODES = ["preview", "execute"] as const;
export const reminderRunModeSchema = z.enum(REMINDER_RUN_MODES);

export const emailReminderRunCreateSchema = z.object({
  mode: reminderRunModeSchema.default("execute"),
  limit: z.number().int().positive().max(500).default(200),
});
export type EmailReminderRunCreate = z.infer<typeof emailReminderRunCreateSchema>;

export const emailReminderRunResponseSchema = successResponseSchema.extend({
  mode: reminderRunModeSchema,
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
export type EmailReminderRunResponse = z.infer<typeof emailReminderRunResponseSchema>;

export const emailReminderRunCreateRouteSchema = {
  tags: ["Email"],
  "x-pkic-auth": { required: true, scopes: ["email:manage"] },
  summary: "Create a reminder run",
  description:
    'Resolves due reminders and queues them into the durable outbox. `mode: "preview"` resolves and returns the same batch without queueing or recording delivery. The run reuses the scheduled D1 query budget, so a manual run cannot exceed the bounds the schedule respects.',
  request: {
    body: { required: true, content: { "application/json": { schema: emailReminderRunCreateSchema } } },
  },
  responses: {
    "200": {
      description: "Reminder run result.",
      content: { "application/json": { schema: emailReminderRunResponseSchema } },
    },
    "400": jsonErrorResponse("Invalid reminder run request."),
    "401": jsonErrorResponse("Staff session required."),
    "403": jsonErrorResponse("Insufficient permission to run email work."),
    "409": jsonErrorResponse("Email permission changed while the run was in progress."),
  },
};
