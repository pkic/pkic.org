import {
  eventSeriesResponseSchema,
  eventSeriesUpdateRouteSchema,
} from "../../../../../../../../assets/shared/schemas/event-series";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";
import { json } from "../../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../../_lib/openapi/route";
import { updateGroupEventSeries } from "../../../../../../../_lib/services/event-series";

export const GroupMeetingSeriesUpdate = openApiRoute(eventSeriesUpdateRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const actor = await requireAdminFromRequest(db, c.req.raw, c.env);
  const series = await updateGroupEventSeries(db, actor, data.params.groupId, data.params.seriesId, data.body);
  return json(eventSeriesResponseSchema.parse({ series }));
});
