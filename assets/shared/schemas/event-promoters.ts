import { z } from "zod";
import { utcInstantSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
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
  userId: databaseIdSchema,
  email: z.email().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  organization: z.string().nullable(),
  jobTitle: z.string().nullable(),
  headshotUrl: httpOrSameOriginUrlSchema.nullable(),
  invitesSent: z.number().int().nonnegative(),
  invitesAccepted: z.number().int().nonnegative(),
  invitesDeclined: z.number().int().nonnegative(),
  invitesExpired: z.number().int().nonnegative(),
  inviteConversionRate: z.number().nullable(),
  lastInviteAt: utcInstantSchema.nullable(),
  referralCodesIssued: z.number().int().nonnegative(),
  referralClicks: z.number().int().nonnegative(),
  referralConversions: z.number().int().nonnegative(),
  impactScore: z.number().int().nonnegative(),
});
export type EventPromoter = z.infer<typeof eventPromoterSchema>;

export const eventReferralCodeSchema = z.object({
  code: z.string(),
  ownerType: z.string(),
  ownerId: databaseIdSchema,
  effectiveUserId: databaseIdSchema.nullable(),
  ownerEmail: z.email().nullable(),
  ownerFirstName: z.string().nullable(),
  ownerLastName: z.string().nullable(),
  channelHint: z.string().nullable(),
  clicks: z.number().int().nonnegative(),
  conversions: z.number().int().nonnegative(),
  createdAt: utcInstantSchema,
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
