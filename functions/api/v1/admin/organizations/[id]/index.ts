/**
 * GET   /api/v1/admin/organizations/:id — organization profile + roster
 * PATCH /api/v1/admin/organizations/:id — update organization profile
 */
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import { writeAuditLog } from "../../../../../_lib/services/audit";
import { getAdminOrganization, updateAdminOrganization } from "../../../../../_lib/services/admin-organizations";
import {
  organizationGetRouteSchema,
  organizationUpdateRouteSchema,
} from "../../../../../../assets/shared/schemas/admin-organizations";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../_lib/openapi/route";

export const OrganizationGet = openApiRoute(organizationGetRouteSchema, async (c: AdminContext, data) => {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "organizations:read");

  const organization = await getAdminOrganization(requestDb(c), data.params.id);
  return json({ organization });
});

export const OrganizationUpdate = openApiRoute(organizationUpdateRouteSchema, async (c: AdminContext, data) => {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "organizations:write");

  const id = data.params.id;
  const body = data.body;
  const organization = await updateAdminOrganization(requestDb(c), id, body);

  await writeAuditLog(requestDb(c), "admin", admin.id, "organization_updated", "organization", id, body);

  return json({ organization });
});
