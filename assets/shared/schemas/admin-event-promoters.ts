import { z } from "zod";
import { listQuerySchema, pageInfoSchema } from "./pagination";

export const EVENT_PROMOTER_SORT_COLUMNS = [
  "impact",
  "accepted",
  "invitations",
  "clicks",
  "conversions",
  "createdAt",
  "code",
] as const;

export const eventPromotersListQuerySchema = listQuerySchema(EVENT_PROMOTER_SORT_COLUMNS).extend({
  view: z.enum(["promoters", "codes"]).optional(),
});

export const eventPromoterSchema = z.object({
  user_id: z.string(),
  email: z.string().nullable(),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  organization: z.string().nullable(),
  job_title: z.string().nullable(),
  headshot_url: z.string().nullable(),
  invites_sent: z.number(),
  invites_accepted: z.number(),
  invites_declined: z.number(),
  invites_expired: z.number(),
  invite_conversion_rate: z.number().nullable(),
  last_invite_at: z.string().nullable(),
  referral_codes_issued: z.number(),
  referral_clicks: z.number(),
  referral_conversions: z.number(),
  impact_score: z.number(),
});
export type EventPromoter = z.infer<typeof eventPromoterSchema>;

export const eventReferralCodeSchema = z.object({
  code: z.string(),
  owner_type: z.string(),
  owner_id: z.string(),
  effective_user_id: z.string().nullable(),
  owner_email: z.string().nullable(),
  owner_first_name: z.string().nullable(),
  owner_last_name: z.string().nullable(),
  channel_hint: z.string().nullable(),
  clicks: z.number(),
  conversions: z.number(),
  created_at: z.string(),
});
export type EventReferralCode = z.infer<typeof eventReferralCodeSchema>;

export const eventPromoterSummarySchema = z.object({
  activePromoters: z.number(),
  promotersWithRegistrations: z.number(),
  totalInvitesSent: z.number(),
  totalInvitesAccepted: z.number(),
  totalReferralClicks: z.number(),
  totalReferralConversions: z.number(),
  referralCodeCount: z.number(),
});

export const eventPromotersListResponseSchema = z.object({
  eventSlug: z.string(),
  view: z.enum(["promoters", "codes"]),
  promoters: z.array(eventPromoterSchema),
  referralCodes: z.array(eventReferralCodeSchema),
  page: pageInfoSchema,
  summary: eventPromoterSummarySchema,
});
export type EventPromotersListResponse = z.infer<typeof eventPromotersListResponseSchema>;

export const eventPromotersListRouteSchema = {
  tags: ["Admin events"],
  summary: "List event promoters or referral codes (admin)",
  description: "Database-ranked and paginated event promotion activity with aggregate summary metrics.",
  request: {
    params: z.object({ eventSlug: z.string().trim().min(1).max(200) }),
    query: eventPromotersListQuerySchema,
  },
  responses: {
    "200": {
      description: "Promotion activity page.",
      content: { "application/json": { schema: eventPromotersListResponseSchema } },
    },
  },
};
