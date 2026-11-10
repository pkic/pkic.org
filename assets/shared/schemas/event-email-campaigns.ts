import { z } from "zod";
import { emailMessageTypeSchema, successResponseSchema, utcInstantSchema } from "./api-common";
import { eventRegistrationStatusFilterSchema } from "./event-registrations";
import { promotionFormatsSchema } from "./event-promotion-kit";
import { attendanceTypeSchema } from "./registration";

export const eventEmailCampaignAudienceSchema = z.enum([
  "attendees",
  "speakers",
  "attendee_invitations",
  "speaker_invitations",
]);
export type EventEmailCampaignAudience = z.infer<typeof eventEmailCampaignAudienceSchema>;

export function isInvitationCampaignAudience(audience: EventEmailCampaignAudience): boolean {
  return audience === "attendee_invitations" || audience === "speaker_invitations";
}
export function isAttendeeCampaignAudience(audience: EventEmailCampaignAudience): boolean {
  return audience === "attendees" || audience === "attendee_invitations";
}

/**
 * The campaign's own vocabularies, each named rather than written inline in
 * the shape below, so the composer can offer exactly what this contract
 * accepts instead of restating the values in its markup.
 */
export const eventEmailCampaignDayWaitlistFilterSchema = z.enum([
  "all",
  "active",
  "waiting",
  "offered",
  "accepted",
  "none",
]);
export type EventEmailCampaignDayWaitlistFilter = z.infer<typeof eventEmailCampaignDayWaitlistFilterSchema>;

export const eventEmailCampaignSpeakerStatusFilterSchema = z.enum([
  "all",
  "confirmed",
  "invited",
  "pending",
  "scheduled",
]);
export type EventEmailCampaignSpeakerStatusFilter = z.infer<typeof eventEmailCampaignSpeakerStatusFilterSchema>;

export const eventEmailCampaignInvitationStatusFilterSchema = z.enum(["all", "sent", "accepted", "expired"]);
export type EventEmailCampaignInvitationStatusFilter = z.infer<typeof eventEmailCampaignInvitationStatusFilterSchema>;

export const eventEmailCampaignSendModeSchema = z.enum(["personal", "bcc_batch"]);
export type EventEmailCampaignSendMode = z.infer<typeof eventEmailCampaignSendModeSchema>;

export const eventEmailCampaignFilterSchema = z.object({
  audience: eventEmailCampaignAudienceSchema,
  attendeeStatus: eventRegistrationStatusFilterSchema.optional(),
  attendanceType: z.union([z.literal("all"), attendanceTypeSchema]).optional(),
  dayDate: z.string().trim().max(20).optional(),
  dayWaitlistStatus: eventEmailCampaignDayWaitlistFilterSchema.optional(),
  speakerStatus: eventEmailCampaignSpeakerStatusFilterSchema.optional(),
  invitationStatus: eventEmailCampaignInvitationStatusFilterSchema.optional(),
});
export type EventEmailCampaignFilter = z.infer<typeof eventEmailCampaignFilterSchema>;

/** The rendered files attached to a message; who receives it stays with the filter. */
export const eventEmailCampaignKitSchema = z.strictObject({
  formats: promotionFormatsSchema,
  resend: z.boolean().default(false),
});
export type EventEmailCampaignKit = z.infer<typeof eventEmailCampaignKitSchema>;

const eventEmailCampaignContentSchema = z.object({
  templateKey: z.string().trim().min(1).max(200).optional(),
  subjectOverride: z.string().trim().min(1).max(500).optional(),
  customText: z.string().trim().max(100_000).optional(),
  bodyContent: z.string().trim().max(100_000).optional(),
  messageType: emailMessageTypeSchema.optional(),
  sendMode: eventEmailCampaignSendModeSchema,
  batchSize: z.number().int().min(1).max(500).default(50),
  filter: eventEmailCampaignFilterSchema,
  kit: eventEmailCampaignKitSchema.optional(),
});

/** A kit exists only for a session on the published agenda, and each one is personal. */
function refineCampaignKit(input: z.infer<typeof eventEmailCampaignContentSchema>, context: z.RefinementCtx) {
  if (!input.kit) return;
  if (input.filter.audience !== "speakers" || input.filter.speakerStatus !== "scheduled") {
    context.addIssue({
      code: "custom",
      path: ["kit"],
      message: "Promotion kits can be attached only for speakers scheduled on the agenda.",
    });
  }
  if (input.sendMode !== "personal") {
    context.addIssue({
      code: "custom",
      path: ["sendMode"],
      message: "Promotion kits must be sent as personal emails.",
    });
  }
}

export const eventEmailCampaignPreviewInputSchema = eventEmailCampaignContentSchema.superRefine(refineCampaignKit);
export type EventEmailCampaignPreviewInput = z.infer<typeof eventEmailCampaignPreviewInputSchema>;

const eventEmailCampaignPreviewTokenSchema = z.string().trim().min(16).max(2048);
export const eventEmailCampaignCreateInputSchema = eventEmailCampaignContentSchema
  .extend({ previewToken: eventEmailCampaignPreviewTokenSchema })
  .superRefine(refineCampaignKit);
export type EventEmailCampaignCreateInput = z.infer<typeof eventEmailCampaignCreateInputSchema>;

export const eventEmailCampaignPreviewResponseSchema = successResponseSchema.extend({
  recipientCount: z.number().int().nonnegative(),
  batchCount: z.number().int().nonnegative(),
  previewToken: eventEmailCampaignPreviewTokenSchema,
  previewExpiresAt: utcInstantSchema,
  sampleRecipients: z.array(z.string().email()),
  subject: z.string(),
  html: z.string(),
  text: z.string(),
});
export type EventEmailCampaignPreviewResponse = z.infer<typeof eventEmailCampaignPreviewResponseSchema>;

export const eventEmailCampaignResponseSchema = successResponseSchema.extend({
  queuedRecipients: z.number().int().nonnegative(),
  queuedBatches: z.number().int().nonnegative(),
  stagedRecipients: z.number().int().nonnegative(),
  mode: eventEmailCampaignSendModeSchema,
});
export type EventEmailCampaignResponse = z.infer<typeof eventEmailCampaignResponseSchema>;

export const speakerKitTestResponseSchema = successResponseSchema.extend({
  sessionTitle: z.string(),
});

export const eventEmailCampaignStageResponseSchema = successResponseSchema.extend({
  processedRecipients: z.number().int().nonnegative(),
  stagedRecipients: z.number().int().nonnegative(),
  remainingRecipients: z.number().int().nonnegative(),
});
