/**
 * DELETE /api/v1/admin/working-groups/:id/members/:userId — remove a member
 */
import { json } from "../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../../_lib/auth/permissions";
import { writeAuditLog } from "../../../../../../_lib/services/audit";
import { removeMemberFromWorkingGroup } from "../../../../../../_lib/services/admin-working-groups";
import { workingGroupMemberRemoveRouteSchema } from "../../../../../../../assets/shared/schemas/working-groups";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../../_lib/openapi/route";

export const WorkingGroupMemberRemove = openApiRoute(
  workingGroupMemberRemoveRouteSchema,
  async (c: AdminContext, data) => {
    const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
    requirePermission(admin, "working-groups:write");

    const wgId = data.params.id;
    const userId = data.params.userId;
    await removeMemberFromWorkingGroup(requestDb(c), wgId, userId);

    await writeAuditLog(requestDb(c), "admin", admin.id, "working_group_member_removed", "working_group", wgId, {
      userId,
    });

    return json({ success: true });
  },
);
