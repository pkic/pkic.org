/**
 * GET   /api/v1/admin/applications/:id — application detail.
 * PATCH /api/v1/admin/applications/:id — correct applicant-submitted fields
 * (does not transition stage; see updateAdminApplication).
 */
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import { getAdminApplicationDetail, updateAdminApplication } from "../../../../../_lib/services/admin-applications";
import {
  adminApplicationDetailRouteSchema,
  applicationUpdateRouteSchema,
} from "../../../../../../assets/shared/schemas/admin-applications";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export const ApplicationDetailGet = openApiRoute(adminApplicationDetailRouteSchema, async (c: AdminContext, data) => {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "membership:read");
  const detail = await getAdminApplicationDetail(requestDb(c), data.params.id);
  return json(detail);
});

export const ApplicationDetailPatch = openApiRoute(applicationUpdateRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  requirePermission(admin, "membership:write");

  const id = data.params.id;
  const body = data.body;
  const detail = await updateAdminApplication(db, id, admin.id, body);

  return json(detail);
});
