/** Cross-group self-participation feed: upcoming meeting occurrences reachable by the current user. */
import { z } from "zod";
import { utcInstantSchema } from "./api-common";
import { eventOccurrenceStatusSchema } from "./event-series";
import { groupIdSchema } from "./groups";
import { databaseIdSchema } from "./identifiers";
import { paginatedResponseSchema, paginationQuerySchemaWithDefaults } from "./pagination";

export const memberMeetingOccurrenceSchema = z.object({
  occurrenceId: databaseIdSchema,
  seriesId: databaseIdSchema,
  eventId: databaseIdSchema,
  groupId: groupIdSchema,
  groupName: z.string(),
  eventName: z.string(),
  startsAt: utcInstantSchema,
  endsAt: utcInstantSchema,
  status: eventOccurrenceStatusSchema,
});
export type MemberMeetingOccurrence = z.infer<typeof memberMeetingOccurrenceSchema>;

/**
 * `from` defaults to "now" — resolved once by the route handler and passed
 * through, never computed inside the query builder — so the default stays
 * out of this schema.
 */
export const currentUserMeetingsListQuerySchema = paginationQuerySchemaWithDefaults().extend({
  from: utcInstantSchema.optional(),
  to: utcInstantSchema.optional(),
});
export type CurrentUserMeetingsListQuery = z.infer<typeof currentUserMeetingsListQuerySchema>;

export const currentUserMeetingsListResponseSchema = paginatedResponseSchema(
  "occurrences",
  memberMeetingOccurrenceSchema,
);
export type CurrentUserMeetingsListResponse = z.infer<typeof currentUserMeetingsListResponseSchema>;
