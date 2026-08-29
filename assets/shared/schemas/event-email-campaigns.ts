import { z } from "zod";
import { emailMessageTypeSchema, successResponseSchema } from "./api-common";
import { eventRegistrationStatusFilterSchema } from "./event-registrations";
import { attendanceTypeSchema } from "./registration";

export const eventEmailCampaignAudienceSchema = z.enum(["attendees", "speakers"]);
export type EventEmailCampaignAudience = z.infer<typeof eventEmailCampaignAudienceSchema>;

export const eventEmailCampaignFilterSchema = z.object({
  audience: eventEmailCampaignAudienceSchema,
  attendeeStatus: eventRegistrationStatusFilterSchema.optional(),
  attendanceType: z.union([z.literal("all"), attendanceTypeSchema]).optional(),
  dayDate: z.string().trim().max(20).optional(),
  dayWaitlistStatus: z.enum(["all", "active", "waiting", "offered", "accepted", "none"]).optional(),
  speakerStatus: z.enum(["all", "confirmed", "invited", "pending"]).optional(),
});
export type EventEmailCampaignFilter = z.infer<typeof eventEmailCampaignFilterSchema>;

export const eventEmailCampaignPreviewInputSchema = z.object({
  templateKey: z.string().trim().min(1).max(200).optional(),
  subjectOverride: z.string().trim().min(1).max(500).optional(),
  customText: z.string().trim().max(100_000).optional(),
  bodyContent: z.string().trim().max(100_000).optional(),
  messageType: emailMessageTypeSchema.optional(),
  sendMode: z.enum(["personal", "bcc_batch"]),
  batchSize: z.number().int().min(1).max(500).default(50),
  filter: eventEmailCampaignFilterSchema,
});
export type EventEmailCampaignPreviewInput = z.infer<typeof eventEmailCampaignPreviewInputSchema>;

export const eventEmailCampaignCreateInputSchema = eventEmailCampaignPreviewInputSchema.extend({
  previewToken: z.string().trim().min(16).max(2048),
});
export type EventEmailCampaignCreateInput = z.infer<typeof eventEmailCampaignCreateInputSchema>;

export const eventEmailCampaignPreviewResponseSchema = successResponseSchema.extend({
  recipientCount: z.number().int().nonnegative(),
  batchCount: z.number().int().nonnegative(),
  previewToken: eventEmailCampaignCreateInputSchema.shape.previewToken,
  previewExpiresAt: z.iso.datetime(),
  sampleRecipients: z.array(z.string().email()),
  subject: z.string(),
  html: z.string(),
  text: z.string(),
});
export type EventEmailCampaignPreviewResponse = z.infer<typeof eventEmailCampaignPreviewResponseSchema>;

export const eventEmailCampaignResponseSchema = successResponseSchema.extend({
  queuedRecipients: z.number().int().nonnegative(),
  queuedBatches: z.number().int().nonnegative(),
  mode: eventEmailCampaignCreateInputSchema.shape.sendMode,
});
export type EventEmailCampaignResponse = z.infer<typeof eventEmailCampaignResponseSchema>;
