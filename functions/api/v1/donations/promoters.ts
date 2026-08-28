import {
  donationPromotersListResponseSchema,
  donationPromotersListRouteSchema,
} from "../../../../assets/shared/schemas/donation-management";
import type { AdminContext } from "../../../_lib/db/context";
import { json } from "../../../_lib/http";
import { openApiRoute } from "../../../_lib/openapi/route";
import { listDonationPromoters } from "../../../_lib/services/donations";
import { requireSystemPermission as requireStaffPermission } from "../system/authorization";

export const DonationPromotersList = openApiRoute(donationPromotersListRouteSchema, async (c: AdminContext, data) => {
  const { db } = await requireStaffPermission(c, "donations:read");
  return json(donationPromotersListResponseSchema.parse(await listDonationPromoters(db, data.query)));
});
