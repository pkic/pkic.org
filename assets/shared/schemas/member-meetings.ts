/** Cross-group self-participation feed: upcoming meeting occurrences reachable by the current user. */
import { z } from "zod";
import { utcInstantSchema } from "./api-common";
import { eventOccurrenceStatusSchema, recurrenceRuleSchema, timeZoneSchema } from "./event-series";
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
  seriesId: databaseIdSchema.optional(),
});
export type CurrentUserMeetingsListQuery = z.infer<typeof currentUserMeetingsListQuerySchema>;

export const currentUserMeetingsListResponseSchema = paginatedResponseSchema(
  "occurrences",
  memberMeetingOccurrenceSchema,
);
export type CurrentUserMeetingsListResponse = z.infer<typeof currentUserMeetingsListResponseSchema>;

export const memberMeetingSeriesSchema = memberMeetingOccurrenceSchema
  .pick({ seriesId: true, eventId: true, groupId: true, groupName: true, eventName: true })
  .extend({
    startsAt: utcInstantSchema,
    recurrenceRule: recurrenceRuleSchema,
    timezone: timeZoneSchema,
    nextOccurrenceId: databaseIdSchema,
    nextStartsAt: utcInstantSchema,
    nextEndsAt: utcInstantSchema,
    canJoin: z.boolean(),
  });
export type MemberMeetingSeries = z.infer<typeof memberMeetingSeriesSchema>;

export const currentUserMeetingSeriesListQuerySchema = currentUserMeetingsListQuerySchema.omit({ seriesId: true });
export const currentUserMeetingSeriesListResponseSchema = paginatedResponseSchema("series", memberMeetingSeriesSchema);
