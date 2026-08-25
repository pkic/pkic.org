import {
  groupEventsListResponseSchema,
  groupEventsListRouteSchema,
} from "../../../../../../assets/shared/schemas/group-events";
import { buildPageInfo } from "../../../../../../assets/shared/schemas/pagination";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { listGroupEvents } from "../../../../../_lib/services/events/group-read-model";
import { requireGroupResourceContext } from "../../group-resource-context";

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
