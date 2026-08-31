import {
  organizationCreateResponseSchema,
  organizationCreateRouteSchema,
  organizationManagementListRouteSchema,
  organizationsListResponseSchema,
} from "../../../../assets/shared/schemas/organization-management";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { json } from "../../../_lib/http";
import { openApiRoute } from "../../../_lib/openapi/route";
import { createOrganization, listOrganizations } from "../../../_lib/services/organization-management";
import type { AdminContext } from "../../../_lib/db/context";
import { requireOrganizationStaffPermission } from "./authorization";
import { requirePermission } from "../../../_lib/auth/permissions";

export const OrganizationsList = openApiRoute(organizationManagementListRouteSchema, async (c: AdminContext, data) => {
  const { db } = await requireOrganizationStaffPermission(c, "organizations:read");
  const { organizations, total } = await listOrganizations(db, data.query);
  return json(
    organizationsListResponseSchema.parse({
      organizations,
      page: buildPageInfo(data.query.limit, data.query.offset, total, organizations.length),
    }),
  );
});

export const OrganizationCreate = openApiRoute(organizationCreateRouteSchema, async (c: AdminContext, data) => {
  const { db, staff } = await requireOrganizationStaffPermission(c, "membership:write");
  requirePermission(staff, "identities:activate");
  return json(
    organizationCreateResponseSchema.parse({ organization: await createOrganization(db, staff, data.body) }),
    201,
  );
});
