/**
 * GET /api/v1/admin/applications — list membership applications.
 */
import { json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { requirePermission } from "../../../../_lib/auth/permissions";
import { listAdminApplications } from "../../../../_lib/services/admin-applications";
import { adminApplicationsListRouteSchema } from "../../../../../assets/shared/schemas/admin-applications";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { buildPageInfo } from "../../../../../assets/shared/schemas/pagination";

export const ApplicationsList = openApiRoute(adminApplicationsListRouteSchema, async (c: AdminContext, data) => {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "membership:read");

  const { stage, q, sort, limit, offset } = data.query;

  const { applications, total } = await listAdminApplications(requestDb(c), { limit, offset, stage, q, sort });
  return json({ applications, page: buildPageInfo(limit, offset, total, applications.length) });
});
