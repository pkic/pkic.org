import {
  organizationMergeCreateRouteSchema,
  organizationMergeResponseSchema,
} from "../../../../../assets/shared/schemas/organization-merge";
import { requirePermission } from "../../../../_lib/auth/permissions";
import type { AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { mergeOrganizations } from "../../../../_lib/services/organization-management/merge";
import { requireOrganizationStaffPermission } from "../authorization";

export const OrganizationMergePost = openApiRoute(organizationMergeCreateRouteSchema, async (c: AdminContext, data) => {
  const { db, staff } = await requireOrganizationStaffPermission(c, "organizations:write");
  requirePermission(staff, "membership:write");
  const merge = await mergeOrganizations(db, staff, data.params.organizationId, data.body);
  return json(organizationMergeResponseSchema.parse({ merge }), 201);
});
