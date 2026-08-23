/**
 * GET /api/v1/admin/organizations — paginated, name-filtered organization
 * list for the admin Organizations section. Creating a brand-new
 * organization is still done via `POST /api/v1/admin/members` (the
 * Interim Admin Tool's org+representative creation flow) — this section
 * manages organizations after they exist, whether created there, via
 * migration, or via application approval.
 */
import { json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { requirePermission } from "../../../../_lib/auth/permissions";
import { listAdminOrganizations } from "../../../../_lib/services/admin-organizations";
import {
  adminOrganizationsListResponseSchema,
  organizationsListRouteSchema,
} from "../../../../../assets/shared/schemas/admin-organizations";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { buildPageInfo } from "../../../../../assets/shared/schemas/pagination";

export const OrganizationsList = openApiRoute(organizationsListRouteSchema, async (c: AdminContext, data) => {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "organizations:read");

  const { organizations, total } = await listAdminOrganizations(requestDb(c), data.query);
  return json(
    adminOrganizationsListResponseSchema.parse({
      organizations,
      page: buildPageInfo(data.query.limit, data.query.offset, total, organizations.length),
    }),
  );
});
