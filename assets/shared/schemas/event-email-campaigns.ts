import { z } from "zod";
import { emailMessageTypeSchema, successResponseSchema, utcInstantSchema } from "./api-common";
import { eventRegistrationStatusFilterSchema } from "./event-registrations";
import { personalPromotionImageFormatSchema } from "../personal-promotion-image";
import { promotionFormatSchema, promotionFormatsSchema } from "./event-promotion-kit";
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
  /** The people picked by hand; the other filters still apply to them. */
  userIds: z.array(z.string().trim().min(1).max(64)).min(1).max(500).optional(),
});
export type EventEmailCampaignFilter = z.infer<typeof eventEmailCampaignFilterSchema>;

/** The rendered files attached to a message; who receives it stays with the filter. */
export const eventEmailCampaignKitSchema = z.strictObject({
  formats: promotionFormatsSchema,
  resend: z.boolean().default(false),
});
export type EventEmailCampaignKit = z.infer<typeof eventEmailCampaignKitSchema>;

/**
 * One file of a person's promotion materials: a session kit format, an attendee
 * kit format, or a badge. A session file names the session it belongs to.
 */
export const promotionMaterialFileSchema = z.discriminatedUnion("kit", [
  z.strictObject({
    kit: z.literal("session"),
    occurrenceId: z.string().trim().min(1).max(64),
    format: promotionFormatSchema,
  }),
  z.strictObject({ kit: z.literal("attendee"), format: promotionFormatSchema }),
  z.strictObject({ kit: z.literal("badge"), format: personalPromotionImageFormatSchema }),
]);
export type PromotionMaterialFile = z.infer<typeof promotionMaterialFileSchema>;

/** One email carries at most this many picked files. */
export const MAX_PROMOTION_MATERIAL_FILES = 24;

/** The files an organizer picked from one person's promotion materials, sent in one email. */
export const eventEmailCampaignMaterialsSchema = z.strictObject({
  files: z
    .array(promotionMaterialFileSchema)
    .min(1, "Choose at least one file.")
    .max(MAX_PROMOTION_MATERIAL_FILES)
    .refine(
      (files) => new Set(files.map((file) => JSON.stringify(file))).size === files.length,
      "Choose each file once.",
    ),
});
export type EventEmailCampaignMaterials = z.infer<typeof eventEmailCampaignMaterialsSchema>;

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
  materials: eventEmailCampaignMaterialsSchema.optional(),
});

/** Attached files are personal: a kit exists only for a scheduled speaker, materials only for one picked person. */
function refineCampaignKit(input: z.infer<typeof eventEmailCampaignContentSchema>, context: z.RefinementCtx) {
  if (input.materials) {
    if (input.kit)
      context.addIssue({ code: "custom", path: ["materials"], message: "Attach either kits or picked files." });
    if (input.filter.userIds?.length !== 1 || input.filter.audience !== "attendees")
      context.addIssue({
        code: "custom",
        path: ["materials"],
        message: "Picked promotion files can be sent only to the one person they belong to.",
      });
  }
  if (input.filter.userIds && isInvitationCampaignAudience(input.filter.audience))
    context.addIssue({
      code: "custom",
      path: ["filter", "userIds"],
      message: "Invitations cannot be picked by person.",
    });
  if ((input.kit || input.materials) && input.sendMode !== "personal") {
    context.addIssue({
      code: "custom",
      path: ["sendMode"],
      message: "Promotion kits must be sent as personal emails.",
    });
  }
  if (!input.kit) return;
  if (input.filter.audience !== "speakers" || input.filter.speakerStatus !== "scheduled") {
    context.addIssue({
      code: "custom",
      path: ["kit"],
      message: "Promotion kits can be attached only for speakers scheduled on the agenda.",
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
