import { z } from "zod";

export const membershipSettingsSchema = z.object({
  consultationWindowDays: z.number().int().min(1).max(60),
  ecReviewWindowDays: z.number().int().min(1).max(60),
  onHoldResponseDeadlineDays: z.number().int().min(1).max(90),
  consultationEmailRecipients: z.string().trim().min(1).max(320),
  ecEmailRecipients: z.string().trim().min(1).max(320),
  ccApplicantEmails: z.string().trim().min(1).max(320),
  autoReminderOnHolds: z.boolean(),
  forumVoteMinEndorsers: z.number().int().min(0).max(50),
  updatedAt: z.string(),
});

export const membershipSettingsUpdateSchema = membershipSettingsSchema.omit({ updatedAt: true }).partial();

export const membershipSettingsGetRouteSchema = {
  tags: ["Membership"],
  summary: "Get membership workflow settings",
  responses: {
    "200": { description: "Current settings.", content: { "application/json": { schema: membershipSettingsSchema } } },
  },
};

export const membershipSettingsUpdateRouteSchema = {
  tags: ["Membership"],
  summary: "Update membership workflow settings",
  request: {
    body: { content: { "application/json": { schema: membershipSettingsUpdateSchema } }, required: true },
  },
  responses: {
    "200": { description: "Updated settings.", content: { "application/json": { schema: membershipSettingsSchema } } },
  },
};
