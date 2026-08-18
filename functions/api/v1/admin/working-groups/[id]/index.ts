/**
 * GET   /api/v1/admin/working-groups/:id — working group detail + full roster (admin, with user ids/emails)
 * PATCH /api/v1/admin/working-groups/:id — update fields, including deactivating (active=false)
 */
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { writeAuditLog } from "../../../../../_lib/services/audit";
import { getAdminWorkingGroupDetail, updateWorkingGroup } from "../../../../../_lib/services/admin-working-groups";
import { AppError } from "../../../../../_lib/errors";
import {
  workingGroupGetRouteSchema,
  workingGroupUpdateRouteSchema,
} from "../../../../../../assets/shared/schemas/working-groups";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../_lib/openapi/route";

// Access is gated by this resource's own router middleware (see
// ../router.ts's requireWorkingGroupAccess), not by a per-handler
// requirePermission call.
export const WorkingGroupGet = openApiRoute(workingGroupGetRouteSchema, async (c: AdminContext, data) => {
  const workingGroup = await getAdminWorkingGroupDetail(requestDb(c), data.params.id);
  if (!workingGroup) {
    throw new AppError(404, "WORKING_GROUP_NOT_FOUND", "Working group not found");
  }
  return json({ workingGroup });
});

export const WorkingGroupUpdate = openApiRoute(workingGroupUpdateRouteSchema, async (c: AdminContext, data) => {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);

  const id = data.params.id;
  const body = data.body;
  const workingGroup = await updateWorkingGroup(requestDb(c), id, body);

  await writeAuditLog(requestDb(c), "admin", admin.id, "working_group_updated", "working_group", id, body);

  return json({ workingGroup });
});
