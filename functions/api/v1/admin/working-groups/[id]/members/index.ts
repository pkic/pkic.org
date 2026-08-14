/**
 * POST /api/v1/admin/working-groups/:id/members — add a member directly (enforces CA constraint)
 */
import { json } from "../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../../_lib/auth/permissions";
import { writeAuditLog } from "../../../../../../_lib/services/audit";
import { addMemberToWorkingGroup } from "../../../../../../_lib/services/admin-working-groups";
import { workingGroupMemberAddRouteSchema } from "../../../../../../../assets/shared/schemas/working-groups";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../../_lib/openapi/route";

export const WorkingGroupMemberAdd = openApiRoute(workingGroupMemberAddRouteSchema, async (c: AdminContext, data) => {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "working-groups:write");

  const wgId = data.params.id;
  const body = data.body;
  await addMemberToWorkingGroup(requestDb(c), wgId, body.userId);

  await writeAuditLog(requestDb(c), "admin", admin.id, "working_group_member_added", "working_group", wgId, {
    userId: body.userId,
  });

  return json({ success: true }, 201);
});
