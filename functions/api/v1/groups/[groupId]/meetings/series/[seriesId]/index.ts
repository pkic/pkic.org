import {
  eventSeriesResponseSchema,
  eventSeriesUpdateRouteSchema,
  groupEventSeriesResponseSchema,
  groupMeetingSeriesDetailRouteSchema,
} from "../../../../../../../../assets/shared/schemas/event-series";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";
import { json } from "../../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../../_lib/openapi/route";
import { getGroupEventSeriesDetail, updateGroupEventSeries } from "../../../../../../../_lib/services/event-series";
import { requireGroupResourceContext } from "../../../../group-resource-context";

export const GroupMeetingSeriesGet = openApiRoute(
  groupMeetingSeriesDetailRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const { group, viewer } = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
    const series = await getGroupEventSeriesDetail(db, viewer, group.id, data.params.seriesId);
    return json(groupEventSeriesResponseSchema.parse({ series }));
  },
);

export const GroupMeetingSeriesUpdate = openApiRoute(eventSeriesUpdateRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const actor = await requireAdminFromRequest(db, c.req.raw, c.env);
  const series = await updateGroupEventSeries(db, actor, data.params.groupId, data.params.seriesId, data.body);
  return json(eventSeriesResponseSchema.parse({ series }));
});
