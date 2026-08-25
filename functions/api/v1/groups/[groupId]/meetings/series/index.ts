import {
  eventSeriesListResponseSchema,
  eventSeriesResponseSchema,
  groupMeetingSeriesCreateRouteSchema,
  groupMeetingSeriesListRouteSchema,
} from "../../../../../../../assets/shared/schemas/event-series";
import { buildPageInfo } from "../../../../../../../assets/shared/schemas/pagination";
import { requireAdminFromRequest } from "../../../../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { json } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import { createGroupEventSeries, listGroupEventSeries } from "../../../../../../_lib/services/event-series";
import { requireGroupResourceContext } from "../../../group-resource-context";

export const GroupMeetingSeriesList = openApiRoute(groupMeetingSeriesListRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const { group, viewer } = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
  const { series, total } = await listGroupEventSeries(db, viewer, group.id, data.query);
  return json(
    eventSeriesListResponseSchema.parse({
      series,
      page: buildPageInfo(data.query.limit, data.query.offset, total, series.length),
    }),
  );
});

export const GroupMeetingSeriesCreate = openApiRoute(
  groupMeetingSeriesCreateRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const actor = await requireAdminFromRequest(db, c.req.raw, c.env);
    const series = await createGroupEventSeries(db, actor, data.params.groupId, data.body);
    return json(eventSeriesResponseSchema.parse({ series }), 201);
  },
);
