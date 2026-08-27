import { eventProfileCatalogResponseSchema } from "../../../../../../assets/shared/schemas/event-management";
import { groupEventProfilesRouteSchema } from "../../../../../../assets/shared/schemas/group-events";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { listActiveEventProfiles } from "../../../../../_lib/services/events/profile-catalog";
import { requireGroupManagementActor, requireGroupResourceContext } from "../../group-resource-context";

export const GroupEventProfilesList = openApiRoute(groupEventProfilesRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const context = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
  requireGroupManagementActor(context);
  return json(eventProfileCatalogResponseSchema.parse({ profiles: await listActiveEventProfiles(db) }));
});
