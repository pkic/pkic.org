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
