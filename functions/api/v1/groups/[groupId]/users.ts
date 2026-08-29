import { groupUsersListRouteSchema } from "../../../../../assets/shared/schemas/user-catalog";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { listGroupUsers } from "../../../../_lib/services/user-catalog";
import { requireGroupManagementActor, requireGroupResourceContext } from "../group-resource-context";

export const GroupUsersList = openApiRoute(groupUsersListRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const context = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
  const actor = requireGroupManagementActor(context);
  return json(await listGroupUsers(db, actor, context.group.id, data.query));
});
