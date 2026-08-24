import {
  eventOccurrenceGuestInviteRouteSchema,
  eventOccurrenceGuestResponseSchema,
  eventOccurrenceGuestsListResponseSchema,
  eventOccurrenceGuestsListRouteSchema,
} from "../../../../../../../../../../../assets/shared/schemas/event-series";
import { buildPageInfo } from "../../../../../../../../../../../assets/shared/schemas/pagination";
import { requireAdminFromRequest } from "../../../../../../../../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../../../../../../../../_lib/db/context";
import { json } from "../../../../../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../../../../../_lib/openapi/route";
import { inviteOccurrenceGuest, listOccurrenceGuests } from "../../../../../../../../../../_lib/services/event-series";

export const GroupMeetingGuestsList = openApiRoute(
  eventOccurrenceGuestsListRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const actor = await requireAdminFromRequest(db, c.req.raw, c.env);
    const { guests, total } = await listOccurrenceGuests(
      db,
      actor,
      data.params.groupId,
      data.params.seriesId,
      data.params.occurrenceId,
      data.query,
    );
    return json(
      eventOccurrenceGuestsListResponseSchema.parse({
        guests,
        page: buildPageInfo(data.query.limit, data.query.offset, total, guests.length),
      }),
    );
  },
);

export const GroupMeetingGuestInvite = openApiRoute(
  eventOccurrenceGuestInviteRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const actor = await requireAdminFromRequest(db, c.req.raw, c.env);
    const guest = await inviteOccurrenceGuest(
      db,
      actor,
      data.params.groupId,
      data.params.seriesId,
      data.params.occurrenceId,
      data.body,
    );
    return json(eventOccurrenceGuestResponseSchema.parse({ guest }), 201);
  },
);
