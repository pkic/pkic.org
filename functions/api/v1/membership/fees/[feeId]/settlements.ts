import {
  membershipFeeSettlementRouteSchema,
  paymentSettlementResponseSchema,
} from "../../../../../../assets/shared/schemas/payment-settlements";
import { requireStaffPermission } from "../../../../../_lib/auth/staff-permissions";
import { resolveAppBaseUrl } from "../../../../../_lib/config";
import type { AdminContext } from "../../../../../_lib/db/context";
import { processSelectedOutboxBackground } from "../../../../../_lib/email/outbox";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { recordOfflineMembershipFeeSettlement } from "../../../../../_lib/services/payments/offline-settlement";

export const MembershipFeeSettlementCreate = openApiRoute(
  membershipFeeSettlementRouteSchema,
  async (c: AdminContext, data) => {
    const { db, staff } = await requireStaffPermission(c, "membership:write");
    const result = await recordOfflineMembershipFeeSettlement(
      db,
      staff,
      data.params.feeId,
      data.body,
      resolveAppBaseUrl(c.env, c.req.raw),
    );
    if (result.outboxIds.length > 0) {
      c.executionCtx.waitUntil(processSelectedOutboxBackground(db, c.env, result.outboxIds));
    }
    const response = paymentSettlementResponseSchema.parse(result);
    return json(response, result.duplicate ? 200 : 201);
  },
);
