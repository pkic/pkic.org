import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { AppError } from "../../../../../_lib/errors";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { endGroupMembership, getGroup, requireGroupManagement } from "../../../../../_lib/services/groups";
import { groupMembershipEndRouteSchema } from "../../../../../../assets/shared/schemas/route-contracts-groups";

export const GroupMembershipEnd = openApiRoute(groupMembershipEndRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  const group = await getGroup(db, data.params.groupId);
  if (!group) throw new AppError(404, "GROUP_NOT_FOUND", "Group not found");
  await requireGroupManagement(db, admin, group.id);
  return json(await endGroupMembership(db, group.id, data.params.membershipId, admin));
});
