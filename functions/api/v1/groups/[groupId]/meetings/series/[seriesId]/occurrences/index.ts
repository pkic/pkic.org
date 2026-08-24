import {
  eventOccurrenceCreateRouteSchema,
  eventOccurrenceResponseSchema,
  eventOccurrencesListResponseSchema,
  eventOccurrencesListRouteSchema,
} from "../../../../../../../../../assets/shared/schemas/event-series";
import { buildPageInfo } from "../../../../../../../../../assets/shared/schemas/pagination";
import { requireAdminFromRequest } from "../../../../../../../../_lib/auth/admin";
import { resolveOptionalGroupViewer } from "../../../../../../../../_lib/auth/group-access";
import { requestDb, type AdminContext } from "../../../../../../../../_lib/db/context";
import { AppError } from "../../../../../../../../_lib/errors";
import { json } from "../../../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../../../_lib/openapi/route";
import { createSeriesOccurrence, listSeriesOccurrences } from "../../../../../../../../_lib/services/event-series";
import { getVisibleGroup } from "../../../../../../../../_lib/services/groups";

export const GroupMeetingOccurrencesList = openApiRoute(
  eventOccurrencesListRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const viewer = await resolveOptionalGroupViewer(db, c.req.raw, c.env);
    const group = await getVisibleGroup(db, data.params.groupId, {
      userId: viewer.userId,
      canReadAll: viewer.canReadAll,
    });
    if (!group) throw new AppError(404, "GROUP_NOT_FOUND", "Group not found or not visible");
    const { occurrences, total } = await listSeriesOccurrences(db, group.id, data.params.seriesId, data.query);
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
