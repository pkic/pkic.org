import {
  donationsListResponseSchema,
  donationsListRouteSchema,
} from "../../../../assets/shared/schemas/donation-management";
import type { AdminContext } from "../../../_lib/db/context";
import { json } from "../../../_lib/http";
import { openApiRoute } from "../../../_lib/openapi/route";
import { listDonations } from "../../../_lib/services/donations";
import { requireSystemPermission as requireStaffPermission } from "../system/authorization";

export const DonationsList = openApiRoute(donationsListRouteSchema, async (c: AdminContext, data) => {
  const { db } = await requireStaffPermission(c, "donations:read");
  return json(donationsListResponseSchema.parse(await listDonations(db, data.query)));
});
