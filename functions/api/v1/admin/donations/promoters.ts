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
  attributed_total: number;
  attributed_completed: number;
  attributed_gross: number;
  currency: string | null;
  created_at: string;
}

export async function onRequestGet(c: any): Promise<Response> {
  await requireAdminFromRequest(c.env.DB, c.req.raw, c.env);
  const db = c.env.DB;

  const promoters = await all<PromoterRow>(
    db,
    `SELECT
       p.code,
       p.name,
       p.checkout_session_id,
       p.clicks,
       p.created_at,
       COUNT(d.id)                                                AS attributed_total,
       COUNT(CASE WHEN d.status = 'completed' THEN 1 END)        AS attributed_completed,
       COALESCE(SUM(CASE WHEN d.status = 'completed' THEN d.gross_amount END), 0) AS attributed_gross,
       -- most common currency from attributed completed donations
       (SELECT d2.currency FROM donations d2
        WHERE d2.source = p.code AND d2.status = 'completed'
        GROUP BY d2.currency ORDER BY COUNT(*) DESC LIMIT 1)     AS currency
     FROM donation_promoters p
     LEFT JOIN donations d ON d.source = p.code
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
