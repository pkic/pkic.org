/**
 * GET /api/v1/admin/applications — list membership applications.
 */
import { json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { requirePermission } from "../../../../_lib/auth/permissions";
import { listAdminApplications } from "../../../../_lib/services/admin-applications";
import {
  adminApplicationsListQuerySchema,
  adminApplicationsListRouteSchema,
} from "../../../../../assets/shared/schemas/admin-applications";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { parseListQuery } from "../../../../_lib/openapi/list-query";
import { buildPageInfo } from "../../../../../assets/shared/schemas/pagination";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "membership:read");

  const {
    stage,
    status,
    sort,
    limit = 50,
    offset = 0,
  } = parseListQuery(adminApplicationsListQuerySchema, new URL(c.req.raw.url), [
    "limit",
    "offset",
    "stage",
    "status",
    "sort",
  ]);

  const { applications, total } = await listAdminApplications(requestDb(c), { limit, offset, stage, status, sort });
  return json({ applications, page: buildPageInfo(limit, offset, total, applications.length) });
}

export const ApplicationsList = openApiRoute(adminApplicationsListRouteSchema, onRequestGet);
