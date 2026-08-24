import {
  eventSeriesMaterializeResponseSchema,
  eventSeriesMaterializeRouteSchema,
} from "../../../../../../../../assets/shared/schemas/event-series";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";
import { json } from "../../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../../_lib/openapi/route";
import { materializeSeriesOccurrences } from "../../../../../../../_lib/services/event-series";

export const GroupMeetingSeriesMaterialize = openApiRoute(
  eventSeriesMaterializeRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const actor = await requireAdminFromRequest(db, c.req.raw, c.env);
    const result = await materializeSeriesOccurrences(db, actor, data.params.groupId, data.params.seriesId, data.body);
    return json(eventSeriesMaterializeResponseSchema.parse(result));
  },
);
