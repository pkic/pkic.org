/**
 * GET /api/v1/admin/donations/:id
 *
 * Returns a single donation by its primary key.
 */

import { json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { getAdminDonationById } from "../../../../_lib/services/donations";
import {
  donationDetailResponseSchema,
  donationDetailRouteSchema,
} from "../../../../../assets/shared/schemas/admin-donations";

export const AdminDonationsIdGet = openApiRoute(donationDetailRouteSchema, async (c: AdminContext, data) => {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const row = await getAdminDonationById(requestDb(c), data.params.id);
  if (!row) return json({ error: { code: "NOT_FOUND", message: "Donation not found" } }, 404);
  return json(donationDetailResponseSchema.parse({ donation: row }));
});
