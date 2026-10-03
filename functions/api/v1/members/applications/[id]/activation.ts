import { openApiRoute } from "../../../../../_lib/openapi/route";
import { json } from "../../../../../_lib/http";
import { requireStaffPermission } from "../../../../../_lib/auth/staff-permissions";
import type { AdminContext } from "../../../../../_lib/db/context";
import { membershipApplicationActivationRouteSchema } from "../../../../../../assets/shared/schemas/membership-application-import-routes";
import { membershipApplicationActivationResponseSchema } from "../../../../../../assets/shared/schemas/membership-application-import";
import { activateImportedApplication } from "../../../../../_lib/services/membership/applications/import-activation";

export const MembershipApplicationActivate = openApiRoute(
  membershipApplicationActivationRouteSchema,
  async (c: AdminContext, data) => {
    const { db, staff } = await requireStaffPermission(c, "membership:approve");
    await activateImportedApplication(db, staff, data.params.id, data.body.reason, data.body.releaseManualHold);
    return json(membershipApplicationActivationResponseSchema.parse({ activated: true }));
  },
);
