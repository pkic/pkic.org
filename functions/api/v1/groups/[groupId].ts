import { requireAdminFromRequest } from "../../../_lib/auth/admin";
import { resolveOptionalGroupViewer } from "../../../_lib/auth/group-access";
import { requestDb, type AdminContext } from "../../../_lib/db/context";
import { AppError } from "../../../_lib/errors";
import { json } from "../../../_lib/http";
import { openApiRoute } from "../../../_lib/openapi/route";
import { getVisibleGroup, updateGroup } from "../../../_lib/services/groups";
import { groupGetRouteSchema, groupUpdateRouteSchema } from "../../../../assets/shared/schemas/route-contracts-groups";

export const GroupGet = openApiRoute(groupGetRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const viewer = await resolveOptionalGroupViewer(db, c.req.raw, c.env);
  const group = await getVisibleGroup(db, data.params.groupId, {
    userId: viewer.userId,
    canReadAll: viewer.canReadAll,
  });
  if (!group) throw new AppError(404, "GROUP_NOT_FOUND", "Group not found or not visible");
  return json({ group });
});

export const GroupUpdate = openApiRoute(groupUpdateRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  return json({ group: await updateGroup(db, admin, data.params.groupId, data.body) });
});
