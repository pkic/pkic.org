import {
  groupEventCreateRouteSchema,
  groupEventsListResponseSchema,
  groupEventsListRouteSchema,
} from "../../../../../../assets/shared/schemas/group-events";
import { buildPageInfo } from "../../../../../../assets/shared/schemas/pagination";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { createGroupManagedEvent } from "../../../../../_lib/services/events/group-management";
import { getGroupEvent, listGroupEvents } from "../../../../../_lib/services/events/group-read-model";
import { requireGroupManagementActor, requireGroupResourceContext } from "../../group-resource-context";

export const GroupEventsList = openApiRoute(groupEventsListRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const { group, viewer } = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
  const result = await listGroupEvents(db, viewer, group.id, data.query);
  return json(
    groupEventsListResponseSchema.parse({
      events: result.events,
      page: buildPageInfo(data.query.limit, data.query.offset, result.total, result.events.length),
    }),
  );
});

export const GroupEventsCreate = openApiRoute(groupEventCreateRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const context = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
  const created = await createGroupManagedEvent(db, requireGroupManagementActor(context), context.group.id, data.body);
  return json(await getGroupEvent(db, context.viewer, context.group.id, created.eventId), 201);
});
