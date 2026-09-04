import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { AppError } from "../../../../../_lib/errors";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import {
  getGroup,
  listEffectiveGroupLeadership,
  revokeLocalGroupLeadership,
  updateLocalGroupLeadership,
} from "../../../../../_lib/services/groups";
import {
  groupLeadershipRevokeRouteSchema,
  groupLeadershipUpdateRouteSchema,
} from "../../../../../../assets/shared/schemas/route-contracts-groups";

export const GroupLeadershipUpdate = openApiRoute(groupLeadershipUpdateRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  const group = await getGroup(db, data.params.groupId);
  if (!group) throw new AppError(404, "GROUP_NOT_FOUND", "Group not found");
  await updateLocalGroupLeadership(db, admin, group.id, data.params.userRoleId, data.body);
  return json(await listEffectiveGroupLeadership(db, group.id));
});

export const GroupLeadershipRevoke = openApiRoute(groupLeadershipRevokeRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  const group = await getGroup(db, data.params.groupId);
  if (!group) throw new AppError(404, "GROUP_NOT_FOUND", "Group not found");
  await revokeLocalGroupLeadership(db, admin, group.id, data.params.userRoleId);
  return json(await listEffectiveGroupLeadership(db, group.id));
});
