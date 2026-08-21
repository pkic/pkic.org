/**
 * DELETE /api/v1/admin/working-groups/:id/members/:userId — remove a member
 */
import { json } from "../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../_lib/auth/admin";
import { removeMemberFromWorkingGroup } from "../../../../../../_lib/services/admin-working-groups";
import { workingGroupMemberRemoveRouteSchema } from "../../../../../../../assets/shared/schemas/working-groups";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../../_lib/openapi/route";

// Access is gated by the parent working-groups/:id/ router's own
// middleware (see ../../router.ts's requireWorkingGroupAccess), not by a
// per-handler requirePermission call.
export const WorkingGroupMemberRemove = openApiRoute(
  workingGroupMemberRemoveRouteSchema,
  async (c: AdminContext, data) => {
    const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);

    const wgId = data.params.id;
    const userId = data.params.userId;
    await removeMemberFromWorkingGroup(requestDb(c), admin.id, wgId, userId);

    return json({ success: true });
  },
);
