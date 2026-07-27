/**
 * GET   /api/v1/admin/working-groups/:id — working group detail + full roster (admin, with user ids/emails)
 * PATCH /api/v1/admin/working-groups/:id — update fields, including deactivating (active=false)
 */
import { OpenAPIRoute } from "chanfana";
import { parseJsonBody } from "../../../../../_lib/validation";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import { writeAuditLog } from "../../../../../_lib/services/audit";
import { getAdminWorkingGroupDetail, updateWorkingGroup } from "../../../../../_lib/services/admin-working-groups";
import { AppError } from "../../../../../_lib/errors";
import {
  workingGroupGetRouteSchema,
  workingGroupUpdateRouteSchema,
  workingGroupUpdateSchema,
} from "../../../../../../assets/shared/schemas/working-groups";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "working-groups:read");

  const workingGroup = await getAdminWorkingGroupDetail(requestDb(c), c.req.param("id"));
  if (!workingGroup) {
    throw new AppError(404, "WORKING_GROUP_NOT_FOUND", "Working group not found");
  }
  return json({ workingGroup });
}

export async function onRequestPatch(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "working-groups:write");

  const id = c.req.param("id");
  const body = await parseJsonBody(c.req, workingGroupUpdateSchema);
  const workingGroup = await updateWorkingGroup(requestDb(c), id, body);

  await writeAuditLog(requestDb(c), "admin", admin.id, "working_group_updated", "working_group", id, body);

  return json({ workingGroup });
}

export class WorkingGroupGet extends OpenAPIRoute {
  schema = workingGroupGetRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestGet(c);
  }
}

export class WorkingGroupUpdate extends OpenAPIRoute {
  schema = workingGroupUpdateRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestPatch(c);
  }
}
