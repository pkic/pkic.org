import {
  donationDetailResponseSchema,
  donationDetailRouteSchema,
} from "../../../../assets/shared/schemas/donation-management";
import type { AdminContext } from "../../../_lib/db/context";
import { json } from "../../../_lib/http";
import { openApiRoute } from "../../../_lib/openapi/route";
import { getDonationById } from "../../../_lib/services/donations";
import { requireSystemPermission as requireStaffPermission } from "../system/authorization";

export const DonationDetailGet = openApiRoute(donationDetailRouteSchema, async (c: AdminContext, data) => {
  const { db } = await requireStaffPermission(c, "donations:read");
  const donation = await getDonationById(db, data.params.id);
  if (!donation) return json({ error: { code: "NOT_FOUND", message: "Donation not found" } }, 404);
  return json(donationDetailResponseSchema.parse({ donation }));
});
