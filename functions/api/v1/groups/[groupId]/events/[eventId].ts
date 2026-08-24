import { groupEventDetailRouteSchema } from "../../../../../../assets/shared/schemas/group-events";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { getGroupEvent } from "../../../../../_lib/services/events/group-read-model";
import { requireGroupResourceContext } from "../../group-resource-context";

export const GroupEventDetailGet = openApiRoute(groupEventDetailRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const { group, viewer } = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
  return json(await getGroupEvent(db, viewer, group.id, data.params.eventId));
});
