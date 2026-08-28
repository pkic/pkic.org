import {
  operationsConsultationBatchRunRouteSchema,
  operationsEcReviewBatchRunRouteSchema,
  type OperationsMembershipBatchKind,
  operationsMembershipBatchResponseSchema,
  operationsWgChairDigestRunRouteSchema,
} from "../../../../../assets/shared/schemas/operations";
import { requirePermission } from "../../../../_lib/auth/permissions";
import type { AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { runMembershipBatchCommand } from "../../../../_lib/services/operations";
import { requireSystemPermission as requireStaffPermission } from "../../system/authorization";

function membershipBatchRoute(
  kind: OperationsMembershipBatchKind,
  routeSchema: typeof operationsConsultationBatchRunRouteSchema,
) {
  return openApiRoute(routeSchema, async (c: AdminContext) => {
    const { db, staff } = await requireStaffPermission(c, "operations:read");
    requirePermission(staff, "operations:run");
    if (kind === "consultation") requirePermission(staff, "membership:write");
    if (kind === "ec-review") requirePermission(staff, "membership:approve");
    return json(operationsMembershipBatchResponseSchema.parse(await runMembershipBatchCommand(db, c.env, staff, kind)));
  });
}

export const OperationsConsultationBatchRunPost = membershipBatchRoute(
  "consultation",
  operationsConsultationBatchRunRouteSchema,
);
export const OperationsEcReviewBatchRunPost = membershipBatchRoute("ec-review", operationsEcReviewBatchRunRouteSchema);
export const OperationsWgChairDigestRunPost = membershipBatchRoute(
  "wg-chair-digest",
  operationsWgChairDigestRunRouteSchema,
);
