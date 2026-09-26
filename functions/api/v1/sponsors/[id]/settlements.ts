import {
  paymentSettlementResponseSchema,
  sponsorshipSettlementRouteSchema,
} from "../../../../../assets/shared/schemas/payment-settlements";
import { requireStaffPermission } from "../../../../_lib/auth/staff-permissions";
import type { AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { recordOfflineSponsorshipSettlement } from "../../../../_lib/services/payments/offline-settlement";

export const SponsorSettlementCreate = openApiRoute(sponsorshipSettlementRouteSchema, async (c: AdminContext, data) => {
  const { db, staff } = await requireStaffPermission(c, "sponsorships:write");
  const result = await recordOfflineSponsorshipSettlement(db, staff, data.params.id, data.body);
  const response = paymentSettlementResponseSchema.parse(result);
  return json(response, result.duplicate ? 200 : 201);
});
