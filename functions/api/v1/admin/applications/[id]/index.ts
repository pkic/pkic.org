/**
 * GET /api/v1/admin/applications/:id — application detail (PRD §4.2).
 */
import { OpenAPIRoute } from "chanfana";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import { getAdminApplicationDetail } from "../../../../../_lib/services/admin-applications";
import { adminApplicationDetailRouteSchema } from "../../../../../../assets/shared/schemas/admin-applications";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "membership:read");
  const detail = await getAdminApplicationDetail(requestDb(c), c.req.param("id"));
  return json(detail);
}

export class ApplicationDetailGet extends OpenAPIRoute {
  schema = adminApplicationDetailRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestGet(c);
  }
}
