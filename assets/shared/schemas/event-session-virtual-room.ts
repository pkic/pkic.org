import { z } from "zod";
import { httpUrlSchema } from "./urls";
import { databaseIdSchema } from "./identifiers";
import { eventSlugParamsSchema, jsonErrorResponse } from "./api-common";
import { requiresSession } from "./route-contract";

export const sessionVirtualRoomResponseSchema = z.object({ url: httpUrlSchema });
export const sessionVirtualRoomRouteSchema = {
  ...requiresSession(),
  tags: ["Events"],
  summary: "Read the approved virtual-room link for an authorized attendee",
  request: { params: eventSlugParamsSchema.extend({ occurrenceId: databaseIdSchema }) },
  responses: {
    "200": {
      description: "Private attendee join destination",
      content: { "application/json": { schema: sessionVirtualRoomResponseSchema } },
    },
    "401": jsonErrorResponse("Sign in required"),
    "403": jsonErrorResponse("Registered attendance and session access required"),
  },
};
