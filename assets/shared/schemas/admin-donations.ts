import { z } from "zod";
import { stripeCheckoutSessionIdSchema } from "./stripe";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import { databaseIdSchema } from "./identifiers";

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
export type DonationStatus = z.infer<typeof donationStatusSchema>;

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
  status: donationStatusSchema,
  payment_method_type: z.string().nullable(),
  session_expires_at: z.number().nullable(),
  settled_amount: z.number().nullable(),
  settled_currency: z.string().nullable(),
  created_at: z.string(),
  completed_at: z.string().nullable(),
});

export const donationsListQuerySchema = listQuerySchema(ADMIN_DONATIONS_SORT_COLUMNS, { limit: 100 }).extend({
  status: donationStatusSchema.optional(),
});
export type DonationsListQuery = z.infer<typeof donationsListQuerySchema>;

export const adminDonationListSummarySchema = z.object({
  byStatus: z.partialRecord(donationStatusSchema, z.number().int().nonnegative()),
  backfillable: z.number().int().nonnegative(),
  syncable: z.number().int().nonnegative(),
});

export const donationsListResponseSchema = paginatedResponseSchema("donations", adminDonationSummarySchema).extend({
  summary: adminDonationListSummarySchema,
});
export type DonationsListResponse = z.infer<typeof donationsListResponseSchema>;
export type AdminDonationListSummary = z.infer<typeof adminDonationListSummarySchema>;

export const donationSyncResultSchema = z.object({
  sessionId: z.string(),
  outcome: z.enum(["completed", "expired", "awaiting_payment", "failed", "still_pending", "error"]),
  error: z.string().optional(),
});

export const donationSyncResponseSchema = z.object({
  synced: z.number(),
  completed: z.number(),
  awaitingPayment: z.number(),
  expired: z.number(),
  failed: z.number(),
  errors: z.number(),
  results: z.array(donationSyncResultSchema),
});
export const ADMIN_DONATION_SYNC_MAX_SESSIONS = 50;

/** Bounded reconciliation input; malformed bodies must never mean "sync all". */
export const donationSyncRequestSchema = z
  .object({
    sessionIds: z.array(stripeCheckoutSessionIdSchema).min(1).max(ADMIN_DONATION_SYNC_MAX_SESSIONS).optional(),
    pendingOnly: z.boolean().optional(),
  })
  .strict();

export const donationSyncPostRouteSchema = {
  tags: ["Donations"],
  summary: "Reconcile donations with Stripe (admin)",
  description:
    "Reconciles a bounded page of pending/incomplete donations, or an explicit bounded set of checkout sessions. " +
    "Filtering and limiting are applied in D1 before Stripe is contacted.",
  request: {
    body: { content: { "application/json": { schema: donationSyncRequestSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Reconciliation results.",
      content: { "application/json": { schema: donationSyncResponseSchema } },
    },
    "400": { description: "Invalid or over-limit reconciliation request." },
    "503": { description: "Stripe is not configured." },
  },
};
export type DonationSyncResponse = z.infer<typeof donationSyncResponseSchema>;
export type DonationSyncRequest = z.infer<typeof donationSyncRequestSchema>;
export type AdminDonationSummary = z.infer<typeof adminDonationSummarySchema>;

export const donationDetailResponseSchema = z.object({ donation: adminDonationSummarySchema });

export const donationDetailRouteSchema = {
  tags: ["Donations"],
  summary: "Get donation details (admin)",
  request: { params: z.object({ id: databaseIdSchema }) },
  responses: {
    "200": {
      description: "Donation details.",
      content: { "application/json": { schema: donationDetailResponseSchema } },
    },
    "400": { description: "Invalid donation identifier." },
    "401": { description: "Admin authorization required." },
    "404": { description: "Donation not found." },
  },
};

export const donationsListRouteSchema = {
  tags: ["Donations"],
  summary: "List donations (admin)",
  description:
    "Paginated, optionally status-filtered list of donations. `summary` contains status and reconciliation counts " +
    "computed across every donation regardless of the current filter or page.",
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
export type DonationPromotersListQuery = z.infer<typeof donationPromotersListQuerySchema>;

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
  promoterCount: z.number().int().nonnegative(),
  totalOwnGrossUsd: z.number(),
  totalAttributedGrossUsd: z.number(),
  totalClicks: z.number().int().nonnegative(),
  totalAttributedCompleted: z.number().int().nonnegative(),
});

export const donationPromotersListResponseSchema = paginatedResponseSchema(
  "promoters",
  adminDonationPromoterSchema,
).extend({
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
