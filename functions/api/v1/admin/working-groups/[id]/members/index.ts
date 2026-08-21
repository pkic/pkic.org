/**
 * POST /api/v1/admin/working-groups/:id/members — add a member directly (enforces CA constraint)
 */
import { json } from "../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../_lib/auth/admin";
import {
  addMemberToWorkingGroup,
  listAdminWorkingGroupMembers,
} from "../../../../../../_lib/services/admin-working-groups";
import {
  workingGroupMemberAddRouteSchema,
  workingGroupMembersListRouteSchema,
} from "../../../../../../../assets/shared/schemas/working-groups";
import { buildPageInfo } from "../../../../../../../assets/shared/schemas/pagination";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../../_lib/openapi/route";

// Access is gated by the parent working-groups/:id/ router's own
// middleware (see ../../router.ts's requireWorkingGroupAccess), not by a
// per-handler requirePermission call.
export const WorkingGroupMemberAdd = openApiRoute(workingGroupMemberAddRouteSchema, async (c: AdminContext, data) => {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);

  const wgId = data.params.id;
  const body = data.body;
  await addMemberToWorkingGroup(requestDb(c), admin.id, wgId, body.userId);

  return json({ success: true }, 201);
});

export const WorkingGroupMembersGet = openApiRoute(
  workingGroupMembersListRouteSchema,
  async (c: AdminContext, data) => {
    const { limit = 50, offset = 0, q, sort } = data.query;
    const result = await listAdminWorkingGroupMembers(requestDb(c), data.params.id, { limit, offset, q, sort });
    return json({
      members: result.members,
      page: buildPageInfo(limit, offset, result.total, result.members.length),
    });
  },
);
