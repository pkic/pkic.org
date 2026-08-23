/** GET /api/v1/admin/donations/promoters */
import { json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { listDonationPromoters } from "../../../../_lib/services/donations/promoters";
import {
  donationPromotersListResponseSchema,
  donationPromotersListRouteSchema,
} from "../../../../../assets/shared/schemas/admin-donations";

export const DonationPromotersList = openApiRoute(donationPromotersListRouteSchema, async (c: AdminContext, data) => {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  return json(donationPromotersListResponseSchema.parse(await listDonationPromoters(requestDb(c), data.query)));
});
