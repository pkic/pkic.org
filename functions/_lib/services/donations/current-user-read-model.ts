/**
 * Identity-first participation feed: every donation matched to the caller's
 * own verified email (see IMPLEMENTATION_TRACKER.md section 13). Mirrors the
 * shape of `event-series/member-read-model.ts`'s `listUpcomingMeetingsForMember`.
 *
 * `donations` carries no `user_id` column at all — donor identity is purely
 * email-based by design (7-year IRS retention; see migration 0003) — so this
 * feed is necessarily email-matched. The match is gated on
 * `users.email_verified_at` so an identity that has never proven ownership
 * of its own address cannot see donations recorded under that address by
 * someone else before it was claimed. `donations.email` is stored
 * lowercased and trimmed at checkout (`donationCheckoutSchema`), the same
 * normalization `users.normalized_email` applies, so this is a plain
 * equality match against `idx_donations_email` — no `LOWER()`/`TRIM()`
 * wrapping needed.
 */
import {
  currentUserDonationSchema,
  type CurrentUserDonation,
  type CurrentUserDonationsListQuery,
} from "../../../../assets/shared/schemas/current-user-donations";
import type { OffsetPageQuery } from "../../db/pagination";
import { queryPage } from "../../db/pagination";
import type { DatabaseLike } from "../../types";

interface CurrentUserDonationRow {
  id: string;
  gross_amount: number;
  currency: string;
  status: string;
  source: string | null;
  created_at: string;
}

function toCurrentUserDonation(row: CurrentUserDonationRow): CurrentUserDonation {
  return currentUserDonationSchema.parse({
    id: row.id,
    grossAmount: row.gross_amount,
    currency: row.currency,
    status: row.status,
    source: row.source,
    createdAt: row.created_at,
  });
}

/** Canonical page/count query, also used by the D1 EXPLAIN plan regression test. */
export function buildCurrentUserDonationsPageQuery(
  userId: string,
  query: CurrentUserDonationsListQuery,
): OffsetPageQuery {
  return {
    sql: `SELECT id, gross_amount, currency, status, source, created_at
          FROM donations
          WHERE email = (SELECT normalized_email FROM users WHERE id = ? AND email_verified_at IS NOT NULL)`,
    bindings: [userId],
    orderBy: "ORDER BY created_at DESC, id ASC",
    limit: query.limit,
    offset: query.offset,
  };
}

export async function listCurrentUserDonations(
  db: DatabaseLike,
  userId: string,
  query: CurrentUserDonationsListQuery,
): Promise<{ donations: CurrentUserDonation[]; total: number }> {
  const { rows, total } = await queryPage<CurrentUserDonationRow>(
    db,
    buildCurrentUserDonationsPageQuery(userId, query),
  );
  return { donations: rows.map(toCurrentUserDonation), total };
}
