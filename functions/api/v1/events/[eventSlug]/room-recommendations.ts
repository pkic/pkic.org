import { roomRecommendationsRouteSchema } from "../../../../../assets/shared/schemas/event-room-recommendations";
import { roomRecommendations } from "../../../../_lib/services/event-participation/room-recommendations";
import { requireSessionParticipantManager } from "../../../../_lib/services/event-participation/management-authorization";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { markResponseSensitive, type AdminContext } from "../../../../_lib/db/context";
import { AppError } from "../../../../_lib/errors";
import { json } from "../../../../_lib/http";
export const SessionRoomRecommendationsGet = openApiRoute(
  roomRecommendationsRouteSchema,
  async (c: AdminContext, data) => {
    markResponseSensitive(c);
    const { db, event, canDelegate } = await requireSessionParticipantManager(
      c,
      data.params.eventSlug,
      data.params.occurrenceId,
    );
    if (!canDelegate)
      throw new AppError(
        403,
        "ROOM_RECOMMENDATIONS_ORGANIZER_REQUIRED",
        "Only organizers can review location recommendations.",
      );
    return json(await roomRecommendations(db, event.id, data.params.eventSlug, data.params.occurrenceId));
  },
);
