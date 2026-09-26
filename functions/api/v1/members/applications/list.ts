/**
 * GET /api/v1/members/applications — list membership applications.
 */
import { json } from "../../../../_lib/http";
import { listMembershipApplications } from "../../../../_lib/services/membership/applications/management";
import {
  membershipApplicationsListResponseSchema,
  membershipApplicationsListRouteSchema,
} from "../../../../../assets/shared/schemas/membership-application-management";
import type { AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { buildPageInfo } from "../../../../../assets/shared/schemas/pagination";
import { requireStaffPermission } from "../../../../_lib/auth/staff-permissions";

export const ApplicationsList = openApiRoute(membershipApplicationsListRouteSchema, async (c: AdminContext, data) => {
  const { db } = await requireStaffPermission(c, "membership:read");

  const { applications, total } = await listMembershipApplications(db, data.query);
  return json(
    membershipApplicationsListResponseSchema.parse({
      applications,
      page: buildPageInfo(data.query.limit, data.query.offset, total, applications.length),
    }),
  );
});
