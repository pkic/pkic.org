import { roomRecommendationsRouteSchema } from "../../../../../assets/shared/schemas/event-room-recommendations";
import { readRoomRecommendationsRequest } from "../../../../_lib/services/event-participation/room-recommendations";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { markResponseSensitive, requestDb, type AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
export const SessionRoomRecommendationsGet = openApiRoute(
  roomRecommendationsRouteSchema,
  async (c: AdminContext, data) => {
    markResponseSensitive(c);
    return json(
      await readRoomRecommendationsRequest(
        requestDb(c),
        c.req.raw,
        c.env,
        data.params.eventSlug,
        data.params.occurrenceId,
      ),
    );
  },
);
