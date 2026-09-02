import { organizationGroupsListRouteSchema } from "../../../../../assets/shared/schemas/organization-activity";
import { jsonPrivate } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { listOrganizationGroups } from "../../../../_lib/services/organization-activity/group-participation";
import type { AdminContext } from "../../../../_lib/db/context";
import { requireOrganizationStaffPermission } from "../authorization";

export const OrganizationGroupsGet = openApiRoute(organizationGroupsListRouteSchema, async (c: AdminContext, data) => {
  const { db } = await requireOrganizationStaffPermission(c, "organizations:read");
  return jsonPrivate(await listOrganizationGroups(db, data.params.organizationId, data.query));
});
