import {
  eventSeriesListResponseSchema,
  eventSeriesResponseSchema,
  groupMeetingSeriesCreateRouteSchema,
  groupMeetingSeriesListRouteSchema,
} from "../../../../../../../assets/shared/schemas/event-series";
import { buildPageInfo } from "../../../../../../../assets/shared/schemas/pagination";
import { requireAdminFromRequest } from "../../../../../../_lib/auth/admin";
import { resolveOptionalGroupViewer } from "../../../../../../_lib/auth/group-access";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { AppError } from "../../../../../../_lib/errors";
import { json } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import { createGroupEventSeries, listGroupEventSeries } from "../../../../../../_lib/services/event-series";
import { getVisibleGroup } from "../../../../../../_lib/services/groups";

export const GroupMeetingSeriesList = openApiRoute(groupMeetingSeriesListRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const viewer = await resolveOptionalGroupViewer(db, c.req.raw, c.env);
  const group = await getVisibleGroup(db, data.params.groupId, {
    userId: viewer.userId,
    canReadAll: viewer.canReadAll,
  });
  if (!group) throw new AppError(404, "GROUP_NOT_FOUND", "Group not found or not visible");
  const { series, total } = await listGroupEventSeries(db, group.id, data.query);
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
