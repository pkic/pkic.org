/**
 * GET   /api/v1/admin/applications/:id — application detail (PRD §4.2).
 * PATCH /api/v1/admin/applications/:id — correct applicant-submitted fields
 * (does not transition stage; see updateAdminApplication).
 */
import { OpenAPIRoute } from "chanfana";
import { parseJsonBody } from "../../../../../_lib/validation";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import { writeAuditLog } from "../../../../../_lib/services/audit";
import { getAdminApplicationDetail, updateAdminApplication } from "../../../../../_lib/services/admin-applications";
import {
  adminApplicationDetailRouteSchema,
  applicationUpdateRouteSchema,
  applicationUpdateSchema,
} from "../../../../../../assets/shared/schemas/admin-applications";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "membership:read");
  const detail = await getAdminApplicationDetail(requestDb(c), c.req.param("id"));
  return json(detail);
}

export async function onRequestPatch(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  requirePermission(admin, "membership:write");

  const id = c.req.param("id");
  const body = await parseJsonBody(c.req, applicationUpdateSchema);
  const detail = await updateAdminApplication(db, id, admin.id, body);

  await writeAuditLog(db, "admin", admin.id, "application_edited", "member_application", id, body);

  return json(detail);
}

export class ApplicationDetailGet extends OpenAPIRoute {
  schema = adminApplicationDetailRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestGet(c);
  }
}

export class ApplicationDetailPatch extends OpenAPIRoute {
  schema = applicationUpdateRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestPatch(c);
  }
}
