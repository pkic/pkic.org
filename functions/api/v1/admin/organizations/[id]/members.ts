/**
 * POST /api/v1/admin/organizations/:id/members — add a representative to an
 * existing organization (find-or-create the user by email, insert an active
 * members row, auto-fill an open primary/secondary contact slot).
 */
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import { addOrganizationRepresentative } from "../../../../../_lib/services/admin-organizations";
import {
  organizationAddRepresentativeRouteSchema,
  organizationRepresentativeResponseSchema,
} from "../../../../../../assets/shared/schemas/admin-organizations";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../_lib/openapi/route";

export const OrganizationAddRepresentative = openApiRoute(
  organizationAddRepresentativeRouteSchema,
  async (c: AdminContext, data) => {
    const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
    requirePermission(admin, "organizations:write");

    const organizationId = data.params.id;
    const body = data.body;
    const representative = await addOrganizationRepresentative(requestDb(c), admin, organizationId, body);

    return json(organizationRepresentativeResponseSchema.parse({ representative }), 201);
  },
);
