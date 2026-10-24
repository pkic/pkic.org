import { listOrganizationsRequest } from "../../../_lib/services/organization-management/list-request";
import { requestDb } from "../../../_lib/db/context";
import {
  organizationCreateResponseSchema,
  organizationCreateRouteSchema,
  organizationManagementListRouteSchema,
  organizationsListResponseSchema,
} from "../../../../assets/shared/schemas/organization-management";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { json } from "../../../_lib/http";
import { openApiRoute } from "../../../_lib/openapi/route";
import { createOrganization } from "../../../_lib/services/organization-management";
import type { AdminContext } from "../../../_lib/db/context";
import { requireOrganizationStaffPermission } from "./authorization";
import { requirePermission } from "../../../_lib/auth/permissions";

export const OrganizationsList = openApiRoute(organizationManagementListRouteSchema, async (c: AdminContext, data) => {
  const { organizations, total } = await listOrganizationsRequest(requestDb(c), c.req.raw, c.env, data.query);
  return json(
    organizationsListResponseSchema.parse({
      organizations,
      page: buildPageInfo(data.query.limit, data.query.offset, total, organizations.length),
    }),
  );
});

export const OrganizationCreate = openApiRoute(organizationCreateRouteSchema, async (c: AdminContext, data) => {
  const { db, staff } = await requireOrganizationStaffPermission(c, "membership:write");
  // Only a request that provides people bypasses the invitation flow by
  // activating them, so only that request needs the activation permission.
  if (data.body.identities.length > 0) requirePermission(staff, "identities:activate");
  return json(
    organizationCreateResponseSchema.parse({ organization: await createOrganization(db, staff, data.body) }),
    201,
  );
});
