/**
 * POST /api/v1/admin/organizations/:id/members — add a representative to an
 * existing organization (find-or-create the user by email, insert an active
 * members row, auto-fill an open primary/secondary contact slot).
 */
import { OpenAPIRoute } from "chanfana";
import { parseJsonBody } from "../../../../../_lib/validation";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import { writeAuditLog } from "../../../../../_lib/services/audit";
import { addOrganizationRepresentative } from "../../../../../_lib/services/admin-organizations";
import {
  organizationAddRepresentativeRouteSchema,
  organizationRepresentativeAddSchema,
} from "../../../../../../assets/shared/schemas/admin-organizations";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "organizations:write");

  const organizationId = c.req.param("id");
  const body = await parseJsonBody(c.req, organizationRepresentativeAddSchema);
  const representative = await addOrganizationRepresentative(requestDb(c), organizationId, body);

  await writeAuditLog(
    requestDb(c),
    "admin",
    admin.id,
    "organization_representative_added",
    "organization",
    organizationId,
    {
      memberId: representative.memberId,
      email: representative.email,
    },
  );

  return json({ representative }, 201);
}

export class OrganizationAddRepresentative extends OpenAPIRoute {
  schema = organizationAddRepresentativeRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestPost(c);
  }
}
