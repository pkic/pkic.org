import { z } from "zod";

const countMapSchema = z.record(z.string(), z.number().int().nonnegative());

const generatedAnalyticsSchema = z.object({
  generatedAt: z.string(),
});

const registrationStatusSummarySchema = z.object({
  byStatus: countMapSchema,
  total: z.number().int().nonnegative(),
});

const donationTotalsSchema = z.object({
  grossUsd: z.number(),
  netUsd: z.number(),
});

export const analyticsSummaryResponseSchema = generatedAnalyticsSchema.extend({
  registrations: registrationStatusSummarySchema,
  invites: z.object({ byStatus: countMapSchema, total: z.number().int().nonnegative() }),
  email: z.object({
    outboxByStatus: countMapSchema,
    totalQueued: z.number().int().nonnegative(),
    totalFailed: z.number().int().nonnegative(),
    totalBounced: z.number().int().nonnegative(),
  }),
  donations: z.object({
    byStatus: countMapSchema,
    totals: donationTotalsSchema,
  }),
  topEvents: z.array(
    z.object({ slug: z.string(), name: z.string(), confirmed: z.number().int(), total: z.number().int() }),
  ),
  recentActivity: z.array(
    z.object({
      date: z.string(),
      registrations: z.number().int().nonnegative(),
      invites: z.number().int().nonnegative(),
    }),
  ),
});

export const registrationAnalyticsResponseSchema = generatedAnalyticsSchema.extend({
  registrations: registrationStatusSummarySchema.extend({
    byAttendanceType: countMapSchema,
    weekly: z.array(z.object({ week: z.string(), count: z.number().int().nonnegative() })),
    monthly: z.array(z.object({ month: z.string(), count: z.number().int().nonnegative() })),
  }),
});

/**
 * A count against a month, for the twelve months behind the reader.
 *
 * Bounded in SQL rather than trimmed here: an analytics page is a read model,
 * and a series with no horizon grows without one.
 */
const monthlySeriesSchema = z.array(z.object({ month: z.string(), count: z.number().int().nonnegative() }));

/** A membership category, named as well as coded — "A", and what an A is. */
const categoryCountSchema = z.object({
  code: z.string(),
  label: z.string(),
  count: z.number().int().nonnegative(),
});

/**
 * What the consortium's roll looks like: how many memberships there are, held
 * under what, standing how, and how many are actually spoken for.
 *
 * A row is one membership — an organization or an individual — never one per
 * representative, because an organization's representatives inherit its
 * membership rather than each holding one of their own. The same rule the
 * roll itself lists by.
 */
export const membershipAnalyticsResponseSchema = generatedAnalyticsSchema.extend({
  members: z.object({
    total: z.number().int().nonnegative(),
    byStatus: countMapSchema,
    /** `individual` and `organization`: the two kinds a membership can be. */
    byKind: countMapSchema,
    byCategory: z.array(categoryCountSchema),
    /**
     * A membership nobody acts for is the one that needs attention: an
     * organization whose last representative left still holds its membership,
     * and nothing reaches it until somebody is seated.
     */
    representation: z.object({
      withRepresentatives: z.number().int().nonnegative(),
      withoutRepresentatives: z.number().int().nonnegative(),
    }),
    joinedMonthly: monthlySeriesSchema,
  }),
});

/**
 * Organizations, and how many of them are members.
 *
 * The distinction is the point: an organization is a record the consortium
 * keeps — an attendee's employer, a sponsor, a company in conversation — and
 * membership is a separate thing it may or may not hold.
 */
export const organizationAnalyticsResponseSchema = generatedAnalyticsSchema.extend({
  organizations: z.object({
    total: z.number().int().nonnegative(),
    /** Holding a membership. */
    members: z.number().int().nonnegative(),
    /** Recorded, but not a member — the majority, and not a problem. */
    recordedOnly: z.number().int().nonnegative(),
    withRepresentatives: z.number().int().nonnegative(),
    withoutRepresentatives: z.number().int().nonnegative(),
    /** What the public directory can actually draw for them. */
    withLogo: z.number().int().nonnegative(),
    withWebsite: z.number().int().nonnegative(),
    createdMonthly: monthlySeriesSchema,
  }),
});

/**
 * Accounts: who can sign in, in what role, and how many act in a membership
 * capacity at all.
 */
export const userAnalyticsResponseSchema = generatedAnalyticsSchema.extend({
  users: z.object({
    total: z.number().int().nonnegative(),
    active: z.number().int().nonnegative(),
    inactive: z.number().int().nonnegative(),
    byRole: countMapSchema,
    /** Holding at least one live identity, and so acting for somebody. */
    withIdentities: z.number().int().nonnegative(),
    /** Able to sign in and acting in no capacity — contacts, mostly. */
    withoutIdentities: z.number().int().nonnegative(),
    createdMonthly: monthlySeriesSchema,
  }),
});

export const donationPeriodSchema = z.object({
  count: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  expired: z.number().int().nonnegative(),
  gross: z.number(),
  grossUsd: z.number(),
  netUsd: z.number(),
});

export const donationAnalyticsResponseSchema = generatedAnalyticsSchema.extend({
  donations: z.object({
    byStatus: countMapSchema,
    byCurrency: z.array(
      z.object({
        status: z.string(),
        currency: z.string(),
        count: z.number().int().nonnegative(),
        totalGross: z.number(),
        averageGross: z.number(),
        totalNet: z.number().nullable(),
        totalGrossUsd: z.number().nullable(),
      }),
    ),
    totals: donationTotalsSchema,
    daily: z.array(donationPeriodSchema.extend({ date: z.string() })),
    weekly: z.array(donationPeriodSchema.extend({ week: z.string() })),
    monthly: z.array(donationPeriodSchema.extend({ month: z.string() })),
  }),
});

export type AnalyticsSummary = z.infer<typeof analyticsSummaryResponseSchema>;
export type RegistrationAnalytics = z.infer<typeof registrationAnalyticsResponseSchema>;
export type DonationAnalytics = z.infer<typeof donationAnalyticsResponseSchema>;
export type DonationPeriod = z.infer<typeof donationPeriodSchema>;

function analyticsRoute(summary: string, description: string, schema: z.ZodType) {
  return {
    tags: ["Analytics"],
    summary,
    responses: {
      "200": { description, content: { "application/json": { schema } } },
      "401": { description: "Authentication required." },
      "403": { description: "Global analytics:read permission required." },
    },
  };
}

export const analyticsSummaryRouteSchema = analyticsRoute(
  "Get the platform analytics summary",
  "Bounded platform-wide registration, invitation, email, donation, event, and activity totals.",
  analyticsSummaryResponseSchema,
);

export const registrationAnalyticsRouteSchema = analyticsRoute(
  "Get registration analytics",
  "Platform-wide registration totals and bounded weekly and monthly series.",
  registrationAnalyticsResponseSchema,
);

export const donationAnalyticsRouteSchema = analyticsRoute(
  "Get donation analytics",
  "Platform-wide donation totals and bounded daily, weekly, and monthly series.",
  donationAnalyticsResponseSchema,
);

export const membershipAnalyticsRouteSchema = analyticsRoute(
  "Get membership analytics",
  "Consortium-wide membership totals by standing, kind and category, representation, and a bounded monthly series.",
  membershipAnalyticsResponseSchema,
);

export const organizationAnalyticsRouteSchema = analyticsRoute(
  "Get organization analytics",
  "Organization record totals, how many hold a membership, how many are represented, and a bounded monthly series.",
  organizationAnalyticsResponseSchema,
);

export const userAnalyticsRouteSchema = analyticsRoute(
  "Get user account analytics",
  "Account totals by standing and role, how many act in a membership capacity, and a bounded monthly series.",
  userAnalyticsResponseSchema,
);

export type MembershipAnalytics = z.infer<typeof membershipAnalyticsResponseSchema>;
export type OrganizationAnalytics = z.infer<typeof organizationAnalyticsResponseSchema>;
export type UserAnalytics = z.infer<typeof userAnalyticsResponseSchema>;
