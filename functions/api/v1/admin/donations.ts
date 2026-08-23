/**
 * GET /api/v1/admin/donations
 *
 * Query params:
 *   status  — filter by status: pending | awaiting_payment | completed | expired | failed (default: all)
 *   limit   — max rows (default 100, shared maximum 200)
 *   offset  — pagination offset (default 0)
 *   sort    — allowlisted column, optionally "-" prefixed for descending (default: created_at desc)
 */

import { json } from "../../../_lib/http";
import { requireAdminFromRequest } from "../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../_lib/db/context";
import { openApiRoute } from "../../../_lib/openapi/route";
import {
  donationsListResponseSchema,
  donationsListRouteSchema,
} from "../../../../assets/shared/schemas/admin-donations";
import { listDonations } from "../../../_lib/services/donations";

export const DonationsList = openApiRoute(donationsListRouteSchema, async (c: AdminContext, data) => {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);

  return json(donationsListResponseSchema.parse(await listDonations(requestDb(c), data.query)));
});
