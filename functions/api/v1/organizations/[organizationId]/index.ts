import {
  organizationDetailResponseSchema,
  organizationManagementGetRouteSchema,
  organizationManagementUpdateRouteSchema,
} from "../../../../../assets/shared/schemas/organization-management";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { getOrganization, updateOrganization } from "../../../../_lib/services/organization-management";
import type { AdminContext } from "../../../../_lib/db/context";
import { requireOrganizationStaffPermission } from "../authorization";

export const OrganizationGet = openApiRoute(organizationManagementGetRouteSchema, async (c: AdminContext, data) => {
  const { db } = await requireOrganizationStaffPermission(c, "organizations:read");
  return json(
    organizationDetailResponseSchema.parse({ organization: await getOrganization(db, data.params.organizationId) }),
  );
});

export const OrganizationUpdate = openApiRoute(
  organizationManagementUpdateRouteSchema,
  async (c: AdminContext, data) => {
    const { db, staff } = await requireOrganizationStaffPermission(c, "organizations:write");
    return json(
      organizationDetailResponseSchema.parse({
        organization: await updateOrganization(db, staff, data.params.organizationId, data.body),
      }),
    );
  },
);
