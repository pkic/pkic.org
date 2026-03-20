/**
 * GET /api/v1/admin/donations
 *
 * Returns a paginated list of donations for the admin console.
 *
 * Query params:
 *   status  — filter by status: pending | completed | expired  (default: all)
 *   limit   — max rows (default 100, max 500)
 *   offset  — pagination offset (default 0)
 */

import { json } from "../../../_lib/http";
import { requireAdminFromRequest } from "../../../_lib/auth/admin";
import { all } from "../../../_lib/db/queries";
import type { PagesContext } from "../../../_lib/types";

interface DonationRow {
  id: string;
  checkout_session_id: string;
  payment_intent_id: string | null;
  name: string;
  email: string;
  organization: string | null;
  currency: string;
  gross_amount: number;
  net_amount: number | null;
  source: string | null;
  status: string;
  created_at: string;
  completed_at: string | null;
}

interface StatusCount {
  status: string;
  count: number;
}

export async function onRequestGet(context: PagesContext): Promise<Response> {
  await requireAdminFromRequest(context.env.DB, context.request, context.env);

  const url = new URL(context.request.url);
  const status = url.searchParams.get("status") ?? "";
  const limit  = Math.min(parseInt(url.searchParams.get("limit") ?? "100") || 100, 500);
  const offset = parseInt(url.searchParams.get("offset") ?? "0") || 0;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (status) {
    conditions.push("status = ?");
    params.push(status);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const [donations, counts] = await Promise.all([
    all<DonationRow>(
      context.env.DB,
      `SELECT id, checkout_session_id, payment_intent_id, name, email,
              organization, currency, gross_amount, net_amount, source,
              status, created_at, completed_at
       FROM donations
       ${where}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    ),
    all<StatusCount>(
      context.env.DB,
      `SELECT status, COUNT(*) AS count FROM donations GROUP BY status`,
      [],
    ),
  ]);

  const summary = Object.fromEntries(counts.map((r) => [r.status, r.count]));

  return json({ donations, summary, limit, offset });
}

export async function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method !== "GET") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestGet(context);
}
