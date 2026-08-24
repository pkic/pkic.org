import {
  eventOccurrenceResponseSchema,
  eventOccurrenceUpdateRouteSchema,
} from "../../../../../../../../../../assets/shared/schemas/event-series";
import { requireAdminFromRequest } from "../../../../../../../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../../../../../../../_lib/db/context";
import { json } from "../../../../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../../../../_lib/openapi/route";
import { updateSeriesOccurrence } from "../../../../../../../../../_lib/services/event-series";

export const GroupMeetingOccurrenceUpdate = openApiRoute(
  eventOccurrenceUpdateRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const actor = await requireAdminFromRequest(db, c.req.raw, c.env);
    const occurrence = await updateSeriesOccurrence(
      db,
      actor,
      data.params.groupId,
      data.params.seriesId,
      data.params.occurrenceId,
      data.body,
      c.env.MEETING_PROVIDER_ENCRYPTION_KEY ?? "",
    );
    return json(eventOccurrenceResponseSchema.parse({ occurrence }));
  },
);
