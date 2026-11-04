import { z } from "zod";
import { badgeAttendeeQuerySchema, badgeAttendeesResponseSchema } from "./route-contracts-event-badges";
import { badgeCredentialSchema } from "./badge-credential";
import { databaseIdSchema } from "./identifiers";
import { eventSlugParamsSchema, jsonErrorResponse } from "./api-common";
import { requiresAnyPermissions } from "./route-contract";

// Reuse the registration identity read model; neither profiles nor credentials are copied into scan records.
export const scannerAttendeesQuerySchema = badgeAttendeeQuerySchema;
export const scannerAttendeesResponseSchema = badgeAttendeesResponseSchema;
export const scannerAttendeeBadgeResponseSchema = z.object({ badgeId: badgeCredentialSchema }).strict();
const access = requiresAnyPermissions(
  ["agenda:scan"],
  ["agenda:check"],
  ["agenda:admit"],
  ["agenda:attendance_record"],
);
export const scannerAttendeesRouteSchema = {
  ...access,
  tags: ["Events"],
  summary: "Find registered attendees for badge scanning",
  request: { params: eventSlugParamsSchema, query: scannerAttendeesQuerySchema },
  responses: {
    "200": {
      description: "Matching attendees",
      content: { "application/json": { schema: scannerAttendeesResponseSchema } },
    },
    "403": jsonErrorResponse("Event scanning permission required"),
  },
};
export const scannerAttendeeBadgeRouteSchema = {
  ...access,
  tags: ["Events"],
  summary: "Resolve one selected attendee's active badge for scanning",
  request: { params: eventSlugParamsSchema.extend({ userId: databaseIdSchema }) },
  responses: {
    "200": {
      description: "Selected badge code; never cache this response",
      content: { "application/json": { schema: scannerAttendeeBadgeResponseSchema } },
    },
    "403": jsonErrorResponse("Event scanning permission required"),
    "409": jsonErrorResponse("An active badge is unavailable"),
  },
};
