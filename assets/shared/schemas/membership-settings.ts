import { z } from "zod";

export const MEMBERSHIP_WINDOW_DAY_LIMITS = {
  consultationWindowDays: { min: 1, max: 60 },
  ecReviewWindowDays: { min: 1, max: 60 },
  onHoldResponseDeadlineDays: { min: 1, max: 90 },
} as const;
export const MEMBERSHIP_EMAIL_RECIPIENTS_MAX_LENGTH = 320;

export const membershipSettingsSchema = z.object({
  consultationWindowDays: z
    .number()
    .int()
    .min(MEMBERSHIP_WINDOW_DAY_LIMITS.consultationWindowDays.min)
    .max(MEMBERSHIP_WINDOW_DAY_LIMITS.consultationWindowDays.max),
  ecReviewWindowDays: z
    .number()
    .int()
    .min(MEMBERSHIP_WINDOW_DAY_LIMITS.ecReviewWindowDays.min)
    .max(MEMBERSHIP_WINDOW_DAY_LIMITS.ecReviewWindowDays.max),
  onHoldResponseDeadlineDays: z
    .number()
    .int()
    .min(MEMBERSHIP_WINDOW_DAY_LIMITS.onHoldResponseDeadlineDays.min)
    .max(MEMBERSHIP_WINDOW_DAY_LIMITS.onHoldResponseDeadlineDays.max),
  consultationEmailRecipients: z.string().trim().min(1).max(MEMBERSHIP_EMAIL_RECIPIENTS_MAX_LENGTH),
  ecEmailRecipients: z.string().trim().min(1).max(MEMBERSHIP_EMAIL_RECIPIENTS_MAX_LENGTH),
  ccApplicantEmails: z.string().trim().min(1).max(MEMBERSHIP_EMAIL_RECIPIENTS_MAX_LENGTH),
  autoReminderOnHolds: z.boolean(),
  revision: z.number().int().nonnegative(),
  updatedAt: z.string(),
});
export type MembershipSettings = z.infer<typeof membershipSettingsSchema>;

const membershipSettingsMutableSchema = membershipSettingsSchema.omit({ revision: true, updatedAt: true });

export const membershipSettingsUpdateSchema = membershipSettingsMutableSchema
  .partial()
  .extend({ expectedRevision: z.number().int().nonnegative() })
  .refine(({ expectedRevision: _expectedRevision, ...changes }) => Object.keys(changes).length > 0, {
    message: "At least one membership setting must be updated",
  });
export type MembershipSettingsUpdate = z.infer<typeof membershipSettingsUpdateSchema>;

export const membershipSettingsGetRouteSchema = {
  tags: ["Membership"],
  summary: "Get membership workflow settings",
  "x-pkic-auth": { required: true, scopes: ["membership:read"] },
  responses: {
    "200": { description: "Current settings.", content: { "application/json": { schema: membershipSettingsSchema } } },
  },
};

export const membershipSettingsUpdateRouteSchema = {
  tags: ["Membership"],
  summary: "Update membership workflow settings",
  "x-pkic-auth": { required: true, scopes: ["membership:write"] },
  request: {
    body: { content: { "application/json": { schema: membershipSettingsUpdateSchema } }, required: true },
  },
  responses: {
    "200": { description: "Updated settings.", content: { "application/json": { schema: membershipSettingsSchema } } },
    "409": { description: "The membership settings changed before the update was committed." },
  },
};
