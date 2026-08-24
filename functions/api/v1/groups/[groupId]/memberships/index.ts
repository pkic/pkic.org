import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { AppError } from "../../../../../_lib/errors";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { getGroup, joinGroup, listGroupMemberships, requireGroupManagement } from "../../../../../_lib/services/groups";
import {
  groupMemberAddRouteSchema,
  groupMembershipsListRouteSchema,
} from "../../../../../../assets/shared/schemas/route-contracts-groups";
import { groupMembershipsListResponseSchema } from "../../../../../../assets/shared/schemas/groups";
import { buildPageInfo } from "../../../../../../assets/shared/schemas/pagination";

export const GroupMembershipsList = openApiRoute(groupMembershipsListRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  const group = await getGroup(db, data.params.groupId);
  if (!group) throw new AppError(404, "GROUP_NOT_FOUND", "Group not found");
  await requireGroupManagement(db, admin, group.id);
  const { memberships, total } = await listGroupMemberships(db, group.id, data.query);
  return json(
    groupMembershipsListResponseSchema.parse({
      memberships,
      page: buildPageInfo(data.query.limit, data.query.offset, total, memberships.length),
    }),
  );
});

export const GroupMemberAdd = openApiRoute(groupMemberAddRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  const group = await getGroup(db, data.params.groupId);
  if (!group) throw new AppError(404, "GROUP_NOT_FOUND", "Group not found");
  await requireGroupManagement(db, admin, group.id);
  return json(
    await joinGroup(db, group.id, {
      actorUserId: admin.id,
      targetUserId: data.params.userId,
      selection: data.body.capacitySelection,
      source: "staff",
      allowManaged: true,
    }),
  );
});
