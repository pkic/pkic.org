/**
 * GET /api/v1/admin/donations
 *
 * Query params:
 *   status  — filter by status: pending | awaiting_payment | completed | expired | failed (default: all)
 *   limit   — max rows (default 100, max 500)
 *   offset  — pagination offset (default 0)
 *   sort    — allowlisted column, optionally "-" prefixed for descending (default: created_at desc)
 */

import { json } from "../../../_lib/http";
import { requireAdminFromRequest } from "../../../_lib/auth/admin";
import { all } from "../../../_lib/db/queries";
import { resolveOrderBy } from "../../../_lib/db/sort";
import { requestDb, type AdminContext } from "../../../_lib/db/context";
import { openApiRoute } from "../../../_lib/openapi/route";
import {
  ADMIN_DONATIONS_SORT_COLUMNS,
  donationsListRouteSchema,
} from "../../../../assets/shared/schemas/admin-donations";

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
  payment_method_type: string | null;
  session_expires_at: number | null;
  settled_amount: number | null;
  settled_currency: string | null;
  created_at: string;
  completed_at: string | null;
}

interface StatusCount {
  status: string;
  count: number;
}

export const DonationsList = openApiRoute(donationsListRouteSchema, async (c: AdminContext, data) => {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);

  const { status, sort, limit = 100, offset = 0 } = data.query;
  const orderBy = resolveOrderBy(sort, ADMIN_DONATIONS_SORT_COLUMNS, "ORDER BY created_at DESC");

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (status) {
    conditions.push("status = ?");
    params.push(status);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const [donations, counts, totalRow] = await Promise.all([
    all<DonationRow>(
      requestDb(c),
      `SELECT id, checkout_session_id, payment_intent_id, name, email,
              organization, currency, gross_amount, net_amount, source,
              status, payment_method_type, session_expires_at,
              settled_amount, settled_currency,
              created_at, completed_at
       FROM donations
       ${where}
       ${orderBy}
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    ),
    all<StatusCount>(requestDb(c), `SELECT status, COUNT(*) AS count FROM donations GROUP BY status`, []),
    all<{ total: number }>(requestDb(c), `SELECT COUNT(*) AS total FROM donations ${where}`, [...params]),
  ]);

  const summary = Object.fromEntries(counts.map((r) => [r.status, r.count]));
  const total = totalRow[0]?.total ?? 0;

  return json({ donations, summary, limit, offset, total });
});
