import {
  membershipFeeSyncResponseSchema,
  membershipFeeSyncRouteSchema,
} from "../../../../../../assets/shared/schemas/payment-settlements";
import { requireStaffPermission } from "../../../../../_lib/auth/staff-permissions";
import { resolveAppBaseUrl } from "../../../../../_lib/config";
import type { AdminContext } from "../../../../../_lib/db/context";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { reconcileMembershipFee } from "../../../../../_lib/services/membership/workflows/fee-reconciliation";

export const MembershipFeeSync = openApiRoute(membershipFeeSyncRouteSchema, async (c: AdminContext, data) => {
  const { db, staff } = await requireStaffPermission(c, "membership:write");
  const response = await reconcileMembershipFee(
    db,
    c.env,
    staff,
    data.params.feeId,
    resolveAppBaseUrl(c.env, c.req.raw),
  );
  return json(membershipFeeSyncResponseSchema.parse(response));
});
