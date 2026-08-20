import { z } from "zod";
import { listQuerySchema, pageInfoSchema } from "./pagination";

/** Allowlisted sort columns for GET /api/v1/admin/donations — see functions/api/v1/admin/donations.ts. */
export const ADMIN_DONATIONS_SORT_COLUMNS = ["name", "gross_amount", "status", "created_at"] as const;

/**
 * Every value donations.status is ever set to — migration 0005 (pending/
 * completed), 0016/sync.ts/webhooks/stripe.ts (awaiting_payment, expired,
 * failed). No DB CHECK constraint backs this (see AGENTS.md — evolvable
 * product vocabulary belongs in a shared Zod module, not a table
 * constraint), so this is the single source of truth for the set.
 */
export const DONATION_STATUSES = ["pending", "awaiting_payment", "completed", "expired", "failed"] as const;
export const donationStatusSchema = z.enum(DONATION_STATUSES);

export const adminDonationSummarySchema = z.object({
  id: z.string(),
  checkout_session_id: z.string(),
  payment_intent_id: z.string().nullable(),
  name: z.string(),
  email: z.string(),
  organization: z.string().nullable(),
  currency: z.string(),
  gross_amount: z.number(),
  net_amount: z.number().nullable(),
  source: z.string().nullable(),
  status: z.string(),
  payment_method_type: z.string().nullable(),
  session_expires_at: z.number().nullable(),
  settled_amount: z.number().nullable(),
  settled_currency: z.string().nullable(),
  created_at: z.string(),
  completed_at: z.string().nullable(),
});

// limit overrides the shared listQuerySchema's max(200) — this list
// has always allowed up to 500 rows per page (functions/api/v1/admin/
// donations.ts's prior Math.min(..., 500)); the default of 100 is applied
// by the route handler, same as every other admin list route.
export const donationsListQuerySchema = listQuerySchema(ADMIN_DONATIONS_SORT_COLUMNS).extend({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  status: donationStatusSchema.optional(),
});

export const donationsListResponseSchema = z.object({
  donations: z.array(adminDonationSummarySchema),
  page: pageInfoSchema,
  summary: z.record(z.string(), z.number()),
});
export type DonationsListResponse = z.infer<typeof donationsListResponseSchema>;
export type AdminDonationSummary = z.infer<typeof adminDonationSummarySchema>;

export const donationsListRouteSchema = {
  tags: ["Donations"],
  summary: "List donations (admin)",
  description:
    "Paginated, optionally status-filtered list of donations. `summary` is a status-count breakdown across every " +
    "donation regardless of the `status` filter (used to render tab/badge counts alongside the filtered list).",
  request: { query: donationsListQuerySchema },
  responses: {
    "200": {
      description: "Donations list.",
      content: {
        "application/json": {
          schema: donationsListResponseSchema,
        },
      },
    },
  },
};

// GET /api/v1/admin/donations/promoters (P6M-P2-12) — dataset is inherently
// small (one row per manually-created marketing promo code), but still
// composes the shared pagination contract for consistency with every other
// list endpoint per AGENTS.md.
export const DONATION_PROMOTER_SORT_COLUMNS = ["impact", "clicks", "donated", "createdAt"] as const;
export const donationPromotersListQuerySchema = listQuerySchema(DONATION_PROMOTER_SORT_COLUMNS);

export const adminDonationPromoterSchema = z.object({
  code: z.string(),
  name: z.string().nullable(),
  checkout_session_id: z.string().nullable(),
  clicks: z.number(),
  own_gross: z.number(),
  own_gross_usd: z.number(),
  own_currency: z.string().nullable(),
  attributed_total: z.number(),
  attributed_completed: z.number(),
  attributed_gross: z.number(),
  attributed_gross_usd: z.number(),
  currency: z.string().nullable(),
  created_at: z.string(),
});
export type AdminDonationPromoter = z.infer<typeof adminDonationPromoterSchema>;

export const adminDonationPromoterSummarySchema = z.object({
  promoterCount: z.number(),
  totalOwnGrossUsd: z.number(),
  totalAttributedGrossUsd: z.number(),
  totalClicks: z.number(),
  totalAttributedCompleted: z.number(),
});

export const donationPromotersListResponseSchema = z.object({
  promoters: z.array(adminDonationPromoterSchema),
  page: pageInfoSchema,
  summary: adminDonationPromoterSummarySchema,
});
export type DonationPromotersListResponse = z.infer<typeof donationPromotersListResponseSchema>;

export const donationPromotersListRouteSchema = {
  tags: ["Donations"],
  summary: "List donation promoter share links (admin)",
  description:
    "Paginated list of every donation promoter share link ordered by click count, with attribution stats " +
    "(donated, pending, failed) derived from donations.source.",
  request: { query: donationPromotersListQuerySchema },
  responses: {
    "200": {
      description: "Promoters list.",
      content: {
        "application/json": { schema: donationPromotersListResponseSchema },
      },
    },
  },
};
