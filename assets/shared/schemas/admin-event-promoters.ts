import { z } from "zod";
import { listQuerySchema, pageInfoSchema } from "./pagination";
import { httpOrSameOriginUrlSchema } from "./urls";

export const EVENT_PROMOTER_SORT_COLUMNS = ["impact", "accepted", "invitations", "clicks"] as const;
export const EVENT_REFERRAL_CODE_SORT_COLUMNS = ["clicks", "conversions", "createdAt", "code"] as const;
const EVENT_PROMOTION_SORT_COLUMNS = [
  "impact",
  "accepted",
  "invitations",
  "clicks",
  "conversions",
  "createdAt",
  "code",
] as const;

/** The omitted view is the promoter view; each view accepts only sort keys its SQL model implements. */
export const eventPromotersListQuerySchema = listQuerySchema(EVENT_PROMOTION_SORT_COLUMNS)
  .extend({ view: z.enum(["promoters", "codes"]).default("promoters") })
  .superRefine((query, ctx) => {
    if (!query.sort) return;
    const sortKey = query.sort.startsWith("-") ? query.sort.slice(1) : query.sort;
    const allowed = query.view === "codes" ? EVENT_REFERRAL_CODE_SORT_COLUMNS : EVENT_PROMOTER_SORT_COLUMNS;
    if (!(allowed as readonly string[]).includes(sortKey)) {
      ctx.addIssue({
        code: "custom",
        path: ["sort"],
        message: `Sort key '${sortKey}' is not available for the ${query.view} view`,
      });
    }
  });
export type EventPromotersListQuery = z.infer<typeof eventPromotersListQuerySchema>;

export const eventPromoterSchema = z.object({
  user_id: z.string(),
  email: z.string().nullable(),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  organization: z.string().nullable(),
  job_title: z.string().nullable(),
  headshot_url: httpOrSameOriginUrlSchema.nullable(),
  invites_sent: z.number().int().nonnegative(),
  invites_accepted: z.number().int().nonnegative(),
  invites_declined: z.number().int().nonnegative(),
  invites_expired: z.number().int().nonnegative(),
  invite_conversion_rate: z.number().nullable(),
  last_invite_at: z.string().nullable(),
  referral_codes_issued: z.number().int().nonnegative(),
  referral_clicks: z.number().int().nonnegative(),
  referral_conversions: z.number().int().nonnegative(),
  impact_score: z.number().int().nonnegative(),
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
  clicks: z.number().int().nonnegative(),
  conversions: z.number().int().nonnegative(),
  created_at: z.string(),
});
export type EventReferralCode = z.infer<typeof eventReferralCodeSchema>;

export const eventPromoterSummarySchema = z.object({
  activePromoters: z.number().int().nonnegative(),
  promotersWithRegistrations: z.number().int().nonnegative(),
  totalInvitesSent: z.number().int().nonnegative(),
  totalInvitesAccepted: z.number().int().nonnegative(),
  totalReferralClicks: z.number().int().nonnegative(),
  totalReferralConversions: z.number().int().nonnegative(),
  referralCodeCount: z.number().int().nonnegative(),
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
