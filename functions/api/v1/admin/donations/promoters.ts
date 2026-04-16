/**
 * GET /api/v1/admin/donations/promoters
 *
 * Returns all donation promoter share links ordered by click count, with
 * attribution stats (donated, pending, failed) derived from donations.source.
 */

import { json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { all } from "../../../../_lib/db/queries";

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

export async function onRequestGet(c: any): Promise<Response> {
  await requireAdminFromRequest(c.env.DB, c.req.raw, c.env);
  const db = c.env.DB;

  const promoters = await all<PromoterRow>(
    db,
    `WITH attributed AS (
       SELECT
         source,
         COUNT(*)                                                      AS attributed_total,
         COUNT(CASE WHEN status = 'completed' THEN 1 END)             AS attributed_completed,
         COALESCE(SUM(CASE WHEN status = 'completed'
                           THEN gross_amount END), 0)                 AS attributed_gross,
         COALESCE(SUM(
           CASE
             WHEN status = 'completed' AND settled_currency = 'usd'  THEN settled_amount
             WHEN status = 'completed' AND currency = 'usd'          THEN gross_amount
             ELSE 0
           END), 0)                                                   AS attributed_gross_usd
         FROM donations
        WHERE source IS NOT NULL
        GROUP BY source
     ),
     dominant_currency AS (
       SELECT source, currency
         FROM (
           SELECT source,
                  currency,
                  ROW_NUMBER() OVER (
                    PARTITION BY source
                    ORDER BY COUNT(*) DESC
                  ) AS rn
             FROM donations
            WHERE source IS NOT NULL
              AND status = 'completed'
            GROUP BY source, currency
         )
        WHERE rn = 1
     )
     SELECT
       p.code,
       p.name,
       p.checkout_session_id,
       p.clicks,
       p.created_at,
       COALESCE(own.gross_amount, 0)             AS own_gross,
       COALESCE(
         CASE
           WHEN own.settled_currency = 'usd' THEN own.settled_amount
           WHEN own.currency = 'usd'         THEN own.gross_amount
           ELSE NULL
         END, 0)                                 AS own_gross_usd,
       own.currency                              AS own_currency,
       COALESCE(a.attributed_total, 0)           AS attributed_total,
       COALESCE(a.attributed_completed, 0)       AS attributed_completed,
       COALESCE(a.attributed_gross, 0)           AS attributed_gross,
       COALESCE(a.attributed_gross_usd, 0)       AS attributed_gross_usd,
       dc.currency
     FROM donation_promoters p
     LEFT JOIN donations own     ON own.id = p.donation_id AND own.status = 'completed'
     LEFT JOIN attributed a      ON a.source = p.code
     LEFT JOIN dominant_currency dc ON dc.source = p.code
     ORDER BY p.clicks DESC, COALESCE(a.attributed_completed, 0) DESC`,
    [],
  );

  return json({ promoters });
}

export async function onRequest(c: any): Promise<Response> {
  if (c.req.raw.method !== "GET") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestGet(c);
}
