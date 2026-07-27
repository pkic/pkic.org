/**
 * GET   /api/v1/admin/organizations/:id — organization profile + roster
 * PATCH /api/v1/admin/organizations/:id — update organization profile
 */
import { OpenAPIRoute } from "chanfana";
import { parseJsonBody } from "../../../../../_lib/validation";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import { writeAuditLog } from "../../../../../_lib/services/audit";
import { getAdminOrganization, updateAdminOrganization } from "../../../../../_lib/services/admin-organizations";
import {
  organizationGetRouteSchema,
  organizationUpdateRouteSchema,
  organizationUpdateSchema,
} from "../../../../../../assets/shared/schemas/admin-organizations";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "organizations:read");

  const organization = await getAdminOrganization(requestDb(c), c.req.param("id"));
  return json({ organization });
}

export async function onRequestPatch(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "organizations:write");

  const id = c.req.param("id");
  const body = await parseJsonBody(c.req, organizationUpdateSchema);
  const organization = await updateAdminOrganization(requestDb(c), id, body);

  await writeAuditLog(requestDb(c), "admin", admin.id, "organization_updated", "organization", id, body);

  return json({ organization });
}

export class OrganizationGet extends OpenAPIRoute {
  schema = organizationGetRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestGet(c);
  }
}

export class OrganizationUpdate extends OpenAPIRoute {
  schema = organizationUpdateRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestPatch(c);
  }
}
