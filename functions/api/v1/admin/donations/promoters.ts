/**
 * GET /api/v1/admin/donations/promoters
 *
 * Returns all donation promoter share links ordered by click count, with
 * attribution stats (donated, pending, failed) derived from donations.source.
 */

import { json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { all } from "../../../../_lib/db/queries";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { donationPromotersListRouteSchema } from "../../../../../assets/shared/schemas/admin-donations";
import { buildPageInfo } from "../../../../../assets/shared/schemas/pagination";

interface PromoterRow {
  code: string;
  name: string | null;
  checkout_session_id: string | null;
  clicks: number;
  own_gross: number;
  own_gross_usd: number;
  own_currency: string | null;
  attributed_total: number;
  attributed_completed: number;
  attributed_gross: number;
  attributed_gross_usd: number;
  currency: string | null;
  created_at: string;
}

interface PromoterBase {
  code: string;
  name: string | null;
  checkout_session_id: string | null;
  clicks: number;
  created_at: string;
  own_gross: number;
  own_gross_usd: number;
  own_currency: string | null;
}

interface AttributedStats {
  source: string;
  attributed_total: number;
  attributed_completed: number;
  attributed_gross: number;
  attributed_gross_usd: number;
}

interface DominantCurrency {
  source: string;
  currency: string;
}

export const DonationPromotersList = openApiRoute(donationPromotersListRouteSchema, async (c: AdminContext, data) => {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const db = requestDb(c);
  const { limit = 100, offset = 0 } = data.query;

  // Three simple queries instead of one complex CTE with window functions,
  // which causes CPU-budget issues in the D1 Workers binding.
  const [bases, attributed, dominantCurrencies] = await Promise.all([
    all<PromoterBase>(
      db,
      `SELECT p.code, p.name, p.checkout_session_id, p.clicks, p.created_at,
              COALESCE(own.gross_amount, 0) AS own_gross,
              COALESCE(
                CASE
                  WHEN own.settled_currency = 'usd' THEN own.settled_amount
                  WHEN own.currency = 'usd'         THEN own.gross_amount
                  ELSE NULL
                END, 0)                    AS own_gross_usd,
              own.currency                 AS own_currency
         FROM donation_promoters p
         LEFT JOIN donations own ON own.id = p.donation_id AND own.status = 'completed'
        ORDER BY p.clicks DESC`,
      [],
    ),
    all<AttributedStats>(
      db,
      `SELECT source,
              COUNT(*)                                                     AS attributed_total,
              COUNT(CASE WHEN status = 'completed' THEN 1 END)            AS attributed_completed,
              COALESCE(SUM(CASE WHEN status = 'completed'
                                THEN gross_amount END), 0)                AS attributed_gross,
              COALESCE(SUM(
                CASE
                  WHEN status = 'completed' AND settled_currency = 'usd' THEN settled_amount
                  WHEN status = 'completed' AND currency = 'usd'         THEN gross_amount
                  ELSE 0
                END), 0)                                                  AS attributed_gross_usd
         FROM donations
        WHERE source IS NOT NULL
        GROUP BY source`,
      [],
    ),
    all<DominantCurrency>(
      db,
      `SELECT source, currency
         FROM donations
        WHERE source IS NOT NULL AND status = 'completed'
        GROUP BY source, currency
        HAVING COUNT(*) = (
          SELECT MAX(cnt) FROM (
            SELECT COUNT(*) AS cnt
              FROM donations
             WHERE source = donations.source AND status = 'completed'
             GROUP BY currency
          )
        )`,
      [],
    ),
  ]);

  const attrMap = new Map(attributed.map((r) => [r.source, r]));
  const currMap = new Map(dominantCurrencies.map((r) => [r.source, r.currency]));

  const promoters: PromoterRow[] = bases.map((p) => {
    const a = attrMap.get(p.code);
    return {
      ...p,
      attributed_total: a?.attributed_total ?? 0,
      attributed_completed: a?.attributed_completed ?? 0,
      attributed_gross: a?.attributed_gross ?? 0,
      attributed_gross_usd: a?.attributed_gross_usd ?? 0,
      currency: currMap.get(p.code) ?? null,
    };
  });

  promoters.sort((a, b) => b.clicks - a.clicks || b.attributed_completed - a.attributed_completed);

  // Pagination is applied to the correctly-ordered merged result rather than
  // to the `bases` query alone: the final sort's tiebreaker
  // (attributed_completed) only exists after merging in the separate
  // attribution-stats query, so a SQL-level LIMIT on `bases` before that
  // merge could put a promoter on the wrong page relative to its real
  // final rank. `donation_promoters` is one row per manually-created promo
  // code (P6M-P2-12) — a small, admin-managed set, not user-generated growth.
  const total = promoters.length;
  const page = promoters.slice(offset, offset + limit);

  return json({ promoters: page, page: buildPageInfo(limit, offset, total, page.length) });
});
