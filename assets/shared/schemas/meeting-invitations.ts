/**
 * A meeting occurrence as a calendar invitation, and what comes back (#126).
 *
 * The invitation a participant receives is an iTIP REQUEST as well as a
 * link; what their calendar answers is recorded against the occurrence and
 * listed here, and cancelling a meeting reaches every calendar that holds it.
 * Split from `event-series.ts`, which is the series and occurrence contracts
 * themselves and had reached the size the repository allows one file.
 */
import { z } from "zod";
import {
  eventManagementErrorResponses,
  eventOccurrenceParamsSchema,
  eventSeriesParamsSchema,
  eventSeriesSchema,
} from "./event-series";
import { databaseIdSchema } from "./identifiers";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import { requiresSession } from "./route-contract";
import { jsonErrorResponse, utcInstantSchema } from "./api-common";

/**
 * One person invited to an occurrence: when their invitation last went out,
 * and what their calendar has answered, if anything.
 */
export const eventOccurrenceInvitationSchema = z.object({
  userId: databaseIdSchema.nullable(),
  name: z.string(),
  email: z.string(),
  /** When the most recent invitation or update was queued for them. */
  sentAt: z.string(),
  response: z.enum(["accepted", "declined", "tentative", "bounced"]).nullable(),
  respondedAt: z.string().nullable(),
});
export type EventOccurrenceInvitation = z.infer<typeof eventOccurrenceInvitationSchema>;
export const EVENT_OCCURRENCE_INVITATION_SORT_COLUMNS = ["name", "sent_at", "response"] as const;
/** What a calendar can have answered, plus `none` for an invitation still unanswered. */
export const eventOccurrenceInvitationResponseFilterSchema = z.enum([
  "accepted",
  "tentative",
  "declined",
  "none",
  "bounced",
]);
export const eventOccurrenceInvitationsListQuerySchema = listQuerySchema(
  EVENT_OCCURRENCE_INVITATION_SORT_COLUMNS,
).extend({
  response: eventOccurrenceInvitationResponseFilterSchema.optional(),
});
export const eventOccurrenceInvitationsListResponseSchema = paginatedResponseSchema(
  "invitations",
  eventOccurrenceInvitationSchema,
);

export const eventOccurrenceGetRouteSchema = {
  ...requiresSession(),
  tags: ["Groups", "Meetings"],
  summary: "Read one meeting occurrence",
  request: { params: eventOccurrenceParamsSchema },
  responses: {
    "200": { description: "The occurrence." },
    "401": jsonErrorResponse("An authenticated portal identity is required."),
    "404": jsonErrorResponse("The meeting series or occurrence is not available through this group."),
  },
};
export const eventOccurrenceInvitationsListRouteSchema = {
  ...requiresSession(),
  tags: ["Groups", "Meetings"],
  summary: "List who was invited to this meeting and what their calendars answered",
  description: "Search, response filtering, sorting, counting, and pagination are executed in D1.",
  request: { params: eventOccurrenceParamsSchema, query: eventOccurrenceInvitationsListQuerySchema },
  responses: { "200": { description: "A bounded invitation page." }, ...eventManagementErrorResponses },
};
export const eventSeriesCancelSchema = z.object({
  expectedUpdatedAt: utcInstantSchema,
});
export const eventSeriesCancelResponseSchema = z.object({
  series: eventSeriesSchema,
  /** The scheduled occurrences that were cancelled with it. */
  cancelledOccurrences: z.number().int().min(0),
});
export const eventSeriesCancelRouteSchema = {
  ...requiresSession(),
  tags: ["Groups", "Meetings"],
  summary: "Cancel a meeting: every upcoming occurrence is cancelled and the series deactivated",
  description:
    "Everyone invited to an upcoming occurrence receives a calendar cancellation. Past and completed occurrences " +
    "are left as they are.",
  request: {
    params: eventSeriesParamsSchema,
    body: { required: true, content: { "application/json": { schema: eventSeriesCancelSchema } } },
  },
  responses: { "200": { description: "The meeting was cancelled." }, ...eventManagementErrorResponses },
};
