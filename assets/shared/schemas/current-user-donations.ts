/**
 * Identity-first participation feed: every donation matched to the caller's
 * own verified email (see IMPLEMENTATION_TRACKER.md section 13). The
 * `donations` table has no `user_id` column at all — donor identity is
 * purely email-based by design (7-year IRS retention, see migration 0003) —
 * so this feed is necessarily email-matched, never user-linked.
 */
import { z } from "zod";
import { utcInstantSchema } from "./api-common";
import { donationManagementSummarySchema, donationStatusSchema } from "./donation-management";
import { databaseIdSchema } from "./identifiers";
import { paginatedResponseSchema, paginationQuerySchemaWithDefaults } from "./pagination";

export const currentUserDonationSchema = z.object({
  id: databaseIdSchema,
  grossAmount: donationManagementSummarySchema.shape.gross_amount,
  currency: donationManagementSummarySchema.shape.currency,
  status: donationStatusSchema,
  /** Attribution/referral source recorded at checkout; the closest field this schema has to a campaign/designation label. */
  source: donationManagementSummarySchema.shape.source,
  createdAt: utcInstantSchema,
});
export type CurrentUserDonation = z.infer<typeof currentUserDonationSchema>;

export const currentUserDonationsListQuerySchema = paginationQuerySchemaWithDefaults();
export type CurrentUserDonationsListQuery = z.infer<typeof currentUserDonationsListQuerySchema>;

export const currentUserDonationsListResponseSchema = paginatedResponseSchema("donations", currentUserDonationSchema);
export type CurrentUserDonationsListResponse = z.infer<typeof currentUserDonationsListResponseSchema>;
