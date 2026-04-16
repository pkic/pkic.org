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
    `WITH currency_rank AS (
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
     SELECT
       p.code,
       p.name,
       p.checkout_session_id,
       p.clicks,
       p.created_at,
       COALESCE(own.gross_amount, 0)                                                AS own_gross,
       COALESCE(
         CASE
           WHEN own.settled_currency = 'usd' THEN own.settled_amount
           WHEN own.currency = 'usd'         THEN own.gross_amount
           ELSE NULL
         END, 0)                                                                    AS own_gross_usd,
       own.currency                                                                  AS own_currency,
       COUNT(d.id)                                                                   AS attributed_total,
       COUNT(CASE WHEN d.status = 'completed' THEN 1 END)                           AS attributed_completed,
       COALESCE(SUM(CASE WHEN d.status = 'completed' THEN d.gross_amount END), 0)   AS attributed_gross,
       COALESCE(SUM(
         CASE
           WHEN d.status = 'completed' AND d.settled_currency = 'usd' THEN d.settled_amount
           WHEN d.status = 'completed' AND d.currency = 'usd'         THEN d.gross_amount
           ELSE 0
         END), 0)                                                                   AS attributed_gross_usd,
       cr.currency
     FROM donation_promoters p
     LEFT JOIN donations own ON own.id = p.donation_id AND own.status = 'completed'
     LEFT JOIN donations d   ON d.source = p.code
     LEFT JOIN currency_rank cr ON cr.source = p.code AND cr.rn = 1
     GROUP BY p.code
     ORDER BY p.clicks DESC, attributed_completed DESC`,
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
