import {
  eventOccurrenceCreateRouteSchema,
  eventOccurrenceResponseSchema,
  eventOccurrencesListResponseSchema,
  eventOccurrencesListRouteSchema,
} from "../../../../../../../../../assets/shared/schemas/event-series";
import { buildPageInfo } from "../../../../../../../../../assets/shared/schemas/pagination";
import { requireAdminFromRequest } from "../../../../../../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../../../../../../_lib/db/context";
import { json } from "../../../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../../../_lib/openapi/route";
import { createSeriesOccurrence, listSeriesOccurrences } from "../../../../../../../../_lib/services/event-series";
import { requireGroupResourceContext } from "../../../../../group-resource-context";

export const GroupMeetingOccurrencesList = openApiRoute(
  eventOccurrencesListRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const { group, viewer } = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
    const { occurrences, total } = await listSeriesOccurrences(db, viewer, group.id, data.params.seriesId, data.query);
    return json(
      eventOccurrencesListResponseSchema.parse({
        occurrences,
        page: buildPageInfo(data.query.limit, data.query.offset, total, occurrences.length),
      }),
    );
  },
);

export const GroupMeetingOccurrenceCreate = openApiRoute(
  eventOccurrenceCreateRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const actor = await requireAdminFromRequest(db, c.req.raw, c.env);
    const occurrence = await createSeriesOccurrence(
      db,
      actor,
      data.params.groupId,
      data.params.seriesId,
      data.body,
      c.env.MEETING_PROVIDER_ENCRYPTION_KEY ?? "",
    );
    return json(eventOccurrenceResponseSchema.parse({ occurrence }), 201);
  },
);
