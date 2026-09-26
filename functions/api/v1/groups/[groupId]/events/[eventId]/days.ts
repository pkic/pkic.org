import {
  groupEventDaysGetRouteSchema,
  groupEventDaysReplaceResponseSchema,
  groupEventDaysReplaceRouteSchema,
  groupEventDaysResponseSchema,
} from "../../../../../../../assets/shared/schemas/group-events";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { json } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import {
  getGroupManagedEventDays,
  replaceGroupManagedEventDays,
} from "../../../../../../_lib/services/events/group-configuration";
import { requireGroupManagementActor, requireGroupResourceContext } from "../../../group-resource-context";

export const GroupEventDaysGet = openApiRoute(groupEventDaysGetRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const context = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
  const result = await getGroupManagedEventDays(
    db,
    requireGroupManagementActor(context),
    context.group.id,
    data.params.eventId,
  );
  return json(groupEventDaysResponseSchema.parse(result));
});

export const GroupEventDaysPut = openApiRoute(groupEventDaysReplaceRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const context = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
  const result = await replaceGroupManagedEventDays(
    db,
    requireGroupManagementActor(context),
    context.group.id,
    data.params.eventId,
    data.body.expectedUpdatedAt,
    data.body.configuration,
  );
  return json(groupEventDaysReplaceResponseSchema.parse(result));
});
