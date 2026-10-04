import { z } from "zod";
import { jsonErrorResponse } from "./api-common";
import { groupEventParamsSchema } from "./group-events";
import { requiresSession } from "./route-contract";
import { eventRegistrationPromotionsResponseSchema } from "./event-registrations";

export const groupEventRegistrationPromotionsCreateRouteSchema = {
  ...requiresSession(),
  tags: ["Groups"],
  summary: "Create waitlist promotion offers for a group event",
  request: { params: groupEventParamsSchema },
  responses: {
    "200": {
      description: "Day-level waitlist promotions processed.",
      content: { "application/json": { schema: eventRegistrationPromotionsResponseSchema } },
    },
    "401": jsonErrorResponse("An authenticated portal identity is required."),
    "403": jsonErrorResponse("Event management access is required."),
    "404": jsonErrorResponse("The event is not available through this group."),
    "409": jsonErrorResponse("Waitlist state or authorization changed."),
  },
};

export const groupEventRegistrationExportRouteSchema = {
  ...requiresSession(),
  tags: ["Groups"],
  summary: "Export group event registrations",
  request: { params: groupEventParamsSchema },
  responses: {
    "200": {
      description: "Bounded CSV representation of event registrations.",
      content: { "text/csv": { schema: z.string() } },
    },
    "401": jsonErrorResponse("An authenticated portal identity is required."),
    "403": jsonErrorResponse("Event management access is required."),
    "404": jsonErrorResponse("The event is not available through this group."),
    "409": jsonErrorResponse("Export authorization changed."),
    "413": jsonErrorResponse("Configured export size limit exceeded."),
  },
};
