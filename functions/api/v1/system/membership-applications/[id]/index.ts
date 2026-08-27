/**
 * GET   /api/v1/system/membership-applications/:id — application detail.
 * PATCH /api/v1/system/membership-applications/:id — correct applicant-submitted fields
 * (does not transition stage; see updateMembershipApplication).
 */
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { json } from "../../../../../_lib/http";
import {
  getMembershipApplicationDetail,
  updateMembershipApplication,
} from "../../../../../_lib/services/membership/applications/management";
import {
  membershipApplicationDetailRouteSchema,
  applicationUpdateRouteSchema,
} from "../../../../../../assets/shared/schemas/membership-application-management";
import type { AdminContext } from "../../../../../_lib/db/context";
import { requireSystemPermission } from "../../authorization";

export const ApplicationDetailGet = openApiRoute(
  membershipApplicationDetailRouteSchema,
  async (c: AdminContext, data) => {
    const { db } = await requireSystemPermission(c, "membership:read");
    const detail = await getMembershipApplicationDetail(db, data.params.id);
    return json(detail);
  },
);

export const ApplicationDetailPatch = openApiRoute(applicationUpdateRouteSchema, async (c: AdminContext, data) => {
  const { db, staff } = await requireSystemPermission(c, "membership:write");

  const id = data.params.id;
  const body = data.body;
  const detail = await updateMembershipApplication(db, id, staff, body);

  return json(detail);
});
