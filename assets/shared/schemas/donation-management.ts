import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import { stripeCheckoutSessionIdSchema } from "./stripe";

/** Allowlisted sort columns for the System donation-management list. */
export const DONATION_MANAGEMENT_SORT_COLUMNS = ["name", "gross_amount", "status", "created_at"] as const;

/**
 * Every value donations.status is ever set to. This evolvable vocabulary is
 * intentionally owned by the shared contract rather than a D1 CHECK
 * constraint.
 */
export const DONATION_STATUSES = ["pending", "awaiting_payment", "completed", "expired", "failed"] as const;
export const donationStatusSchema = z.enum(DONATION_STATUSES);
export type DonationStatus = z.infer<typeof donationStatusSchema>;

export const donationManagementSummarySchema = z.object({
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
export type DonationManagementSummary = z.infer<typeof donationManagementSummarySchema>;

export const donationsListQuerySchema = listQuerySchema(DONATION_MANAGEMENT_SORT_COLUMNS, { limit: 100 }).extend({
  status: donationStatusSchema.optional(),
});
export type DonationsListQuery = z.infer<typeof donationsListQuerySchema>;

export const donationManagementListSummarySchema = z.object({
  byStatus: z.partialRecord(donationStatusSchema, z.number().int().nonnegative()),
  backfillable: z.number().int().nonnegative(),
  syncable: z.number().int().nonnegative(),
});
export type DonationManagementListSummary = z.infer<typeof donationManagementListSummarySchema>;

export const donationsListResponseSchema = paginatedResponseSchema("donations", donationManagementSummarySchema).extend(
  {
    summary: donationManagementListSummarySchema,
  },
);
export type DonationsListResponse = z.infer<typeof donationsListResponseSchema>;

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
export type DonationSyncResponse = z.infer<typeof donationSyncResponseSchema>;

/** Maximum Stripe sessions a staff reconciliation request may select. */
export const DONATION_SYNC_MAX_SESSIONS = 50;

/** Bounded reconciliation input; malformed bodies must never mean "sync all". */
export const donationSyncRequestSchema = z
  .object({
    sessionIds: z.array(stripeCheckoutSessionIdSchema).min(1).max(DONATION_SYNC_MAX_SESSIONS).optional(),
    pendingOnly: z.boolean().optional(),
  })
  .strict();
export type DonationSyncRequest = z.infer<typeof donationSyncRequestSchema>;

export const donationSyncPostRouteSchema = {
  tags: ["Donations"],
  "x-pkic-auth": { required: true, scopes: ["donations:sync"] },
  summary: "Reconcile donations with Stripe",
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
    "401": { description: "Authentication required." },
    "403": { description: "A live user-backed donations:sync permission is required." },
    "409": { description: "The operator's donations:sync permission changed during reconciliation." },
    "503": { description: "Stripe is not configured." },
  },
};

export const donationDetailResponseSchema = z.object({ donation: donationManagementSummarySchema });

export const donationDetailRouteSchema = {
  tags: ["Donations"],
  "x-pkic-auth": { required: true, scopes: ["donations:read"] },
  summary: "Get donation details",
  request: { params: z.object({ id: databaseIdSchema }) },
  responses: {
    "200": {
      description: "Donation details.",
      content: { "application/json": { schema: donationDetailResponseSchema } },
    },
    "400": { description: "Invalid donation identifier." },
    "401": { description: "Authentication required." },
    "403": { description: "A live user-backed donations:read permission is required." },
    "404": { description: "Donation not found." },
  },
};

export const donationsListRouteSchema = {
  tags: ["Donations"],
  "x-pkic-auth": { required: true, scopes: ["donations:read"] },
  summary: "List donations",
  description:
    "Paginated, optionally status-filtered list of donations. `summary` contains status and reconciliation counts " +
    "computed across every donation regardless of the current filter or page.",
  request: { query: donationsListQuerySchema },
  responses: {
    "200": {
      description: "Donations list.",
      content: { "application/json": { schema: donationsListResponseSchema } },
    },
    "401": { description: "Authentication required." },
    "403": { description: "A live user-backed donations:read permission is required." },
  },
};

export const DONATION_PROMOTER_SORT_COLUMNS = ["impact", "clicks", "donated", "createdAt"] as const;
export const donationPromotersListQuerySchema = listQuerySchema(DONATION_PROMOTER_SORT_COLUMNS);
export type DonationPromotersListQuery = z.infer<typeof donationPromotersListQuerySchema>;

export const donationPromoterSchema = z.object({
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
export type DonationPromoter = z.infer<typeof donationPromoterSchema>;

export const donationPromoterSummarySchema = z.object({
  promoterCount: z.number().int().nonnegative(),
  totalOwnGrossUsd: z.number(),
  totalAttributedGrossUsd: z.number(),
  totalClicks: z.number().int().nonnegative(),
  totalAttributedCompleted: z.number().int().nonnegative(),
});

export const donationPromotersListResponseSchema = paginatedResponseSchema("promoters", donationPromoterSchema).extend({
  summary: donationPromoterSummarySchema,
});
export type DonationPromotersListResponse = z.infer<typeof donationPromotersListResponseSchema>;

export const donationPromotersListRouteSchema = {
  tags: ["Donations"],
  "x-pkic-auth": { required: true, scopes: ["donations:read"] },
  summary: "List donation promoter share links",
  description:
    "Paginated list of donation promoter share links ordered by click count, with attribution statistics " +
    "derived from donations.source.",
  request: { query: donationPromotersListQuerySchema },
  responses: {
    "200": {
      description: "Promoters list.",
      content: { "application/json": { schema: donationPromotersListResponseSchema } },
    },
    "401": { description: "Authentication required." },
    "403": { description: "A live user-backed donations:read permission is required." },
  },
};
