import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import {
  eventAttendanceRegistrationsQuerySchema,
  eventAttendanceRegistrationSummarySchema,
} from "./event-registrations";
import { cursorPaginationQuerySchema, cursorPaginatedResponseSchema } from "./pagination";
import { groupEventParamsSchema } from "./group-events";
import { requiresSession } from "./route-contract";
import { jsonErrorResponse } from "./api-common";

export const eventBadgePrintPopulationQuerySchema = eventAttendanceRegistrationsQuerySchema
  .pick({ q: true, status: true, waitlisted: true, attendance_type: true, badge_role: true })
  .merge(cursorPaginationQuerySchema(databaseIdSchema))
  .strict();
export type EventBadgePrintPopulationQuery = z.infer<typeof eventBadgePrintPopulationQuerySchema>;
export const eventBadgePrintPopulationItemSchema = eventAttendanceRegistrationSummarySchema
  .pick({
    id: true,
    user_id: true,
    display_name: true,
    status: true,
  })
  .extend({ id: databaseIdSchema, user_id: databaseIdSchema });
export const eventBadgePrintPopulationResponseSchema = cursorPaginatedResponseSchema(
  "registrations",
  eventBadgePrintPopulationItemSchema,
  databaseIdSchema,
);
export type EventBadgePrintPopulationResponse = z.infer<typeof eventBadgePrintPopulationResponseSchema>;

export const eventBadgePrintPopulationRouteSchema = {
  ...requiresSession(),
  tags: ["Groups"],
  summary: "List eligible registered attendees for badge printing",
  description:
    "Keyset pages of matching active registered attendees. Counts are live; no frozen population is promised.",
  request: { params: groupEventParamsSchema, query: eventBadgePrintPopulationQuerySchema },
  responses: {
    "200": {
      description: "One bounded eligible population page.",
      content: { "application/json": { schema: eventBadgePrintPopulationResponseSchema } },
    },
    "401": jsonErrorResponse("An authenticated portal identity is required."),
    "403": jsonErrorResponse("Event management access is required."),
    "404": jsonErrorResponse("The event is not available through this group."),
    "409": jsonErrorResponse("Event management authorization changed."),
  },
};
