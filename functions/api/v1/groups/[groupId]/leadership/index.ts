import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { AppError } from "../../../../../_lib/errors";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import {
  assignLocalGroupLeadership,
  getGroup,
  listEffectiveGroupLeadership,
  requireGroupManagement,
} from "../../../../../_lib/services/groups";
import {
  groupLeadershipAssignRouteSchema,
  groupLeadershipListRouteSchema,
} from "../../../../../../assets/shared/schemas/route-contracts-groups";

export const GroupLeadershipList = openApiRoute(groupLeadershipListRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  const group = await getGroup(db, data.params.groupId);
  if (!group) throw new AppError(404, "GROUP_NOT_FOUND", "Group not found");
  await requireGroupManagement(db, admin, group.id);
  return json(await listEffectiveGroupLeadership(db, group.id));
});

export const GroupLeadershipAssign = openApiRoute(groupLeadershipAssignRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  const group = await getGroup(db, data.params.groupId);
  if (!group) throw new AppError(404, "GROUP_NOT_FOUND", "Group not found");
  await assignLocalGroupLeadership(db, admin, group.id, data.body);
  return json(await listEffectiveGroupLeadership(db, group.id), 201);
});
