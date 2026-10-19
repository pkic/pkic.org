/**
 * Transport contracts for the attendance reports built on self check-in: the
 * check-in records with each person's standing, per-session attributed
 * attendance, and each person's movement between sessions. Attribution policy
 * lives in `../attendance-attribution.ts`; it runs on the server only.
 */
import { z } from "zod";
import { MINIMUM_STAY_PERCENT } from "../attendance-attribution";
import { attendancePointKindSchema, attendeeStandingSchema } from "../attendance-points";
import { utcInstantSchema } from "./api-common";
import { eventDayDateSchema } from "./event-read-models";
import { databaseIdSchema } from "./identifiers";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";

const count = z.number().int().nonnegative();
const roomSchema = z.object({ id: databaseIdSchema, name: z.string() }).strict();
const personFields = {
  userId: databaseIdSchema,
  displayName: z.string().nullable(),
  email: z.string().nullable(),
};
const sessionSchema = z
  .object({
    id: databaseIdSchema,
    title: z.string(),
    startAt: utcInstantSchema,
    endAt: utcInstantSchema,
    room: roomSchema.nullable(),
  })
  .strict();

/**
 * Self check-ins (check-outs are not listed), one per person, day and place:
 * the first check-in there, however often the person came and went. `expected=no` lists everyone who checked in
 * without being registered for the day, without an in-person place, or to a
 * session without the seat it asks for; `expected=yes` lists everyone else.
 */
export const selfCheckInBookingSchema = z.enum(["booked", "not_booked"]);
export const selfCheckInExpectationSchema = z.enum(["no", "yes"]);

export const selfCheckInsQuerySchema = listQuerySchema(["observedAt", "name"] as const).extend({
  standing: attendeeStandingSchema.optional(),
  booking: selfCheckInBookingSchema.optional(),
  expected: selfCheckInExpectationSchema.optional(),
  kind: attendancePointKindSchema.optional(),
  occurrenceId: databaseIdSchema.optional(),
  dayDate: eventDayDateSchema.optional(),
});
export type SelfCheckInsQuery = z.infer<typeof selfCheckInsQuerySchema>;

export const selfCheckInSchema = z
  .object({
    id: databaseIdSchema,
    observedAt: utcInstantSchema,
    dayDate: eventDayDateSchema,
    person: z.object(personFields).strict(),
    pointKind: attendancePointKindSchema,
    standing: attendeeStandingSchema,
    /** For a session: whether the person held the seat it asks for. Null for venue codes. */
    booked: z.boolean().nullable(),
    /** False when the person was not registered, had no in-person place, or had no seat booked. */
    expected: z.boolean(),
    session: z.object({ id: databaseIdSchema, title: z.string() }).strict().nullable(),
    room: roomSchema.nullable(),
  })
  .strict();
export type SelfCheckIn = z.infer<typeof selfCheckInSchema>;
export const selfCheckInsResponseSchema = paginatedResponseSchema("checkIns", selfCheckInSchema);

/** Sessions with their in-person attendance after attribution; one page of sessions per request. */
export const attendanceAttributionsQuerySchema = listQuerySchema(["startAt", "title", "checkedIn"] as const, {
  maxLimit: 100,
});

export const sessionAttributionSchema = z
  .object({
    session: sessionSchema,
    /** People checked in to the session in person; each person counts once, however often they scanned. */
    checkedIn: count,
    /** In-person people attributed to the session: it was where they stayed longest among overlapping sessions. */
    attributed: count,
    /** People who checked in while attending online; never part of in-person attendance. */
    remote: count,
    /** In-person people who were not registered, had no in-person place, or had no seat booked. */
    unexpected: count,
  })
  .strict();
export type SessionAttribution = z.infer<typeof sessionAttributionSchema>;
/** The share of a session a stay had to cover to count, as the event set it when the report was made. */
const minimumStayPercent = z.number().int().min(MINIMUM_STAY_PERCENT.min).max(MINIMUM_STAY_PERCENT.max);

export const attendanceAttributionsResponseSchema = paginatedResponseSchema(
  "sessions",
  sessionAttributionSchema,
).extend({ minimumStayPercent });

/** People who checked in to at least one session in person, with their stays in order. */
export const attendanceMovementsQuerySchema = listQuerySchema(["name", "firstCheckInAt"] as const, {
  limit: 25,
  maxLimit: 100,
}).extend({
  dayDate: eventDayDateSchema.optional(),
  userId: databaseIdSchema.optional(),
});

export const sessionStaySchema = z
  .object({
    session: sessionSchema,
    checkedInAt: utcInstantSchema,
    leftAt: utcInstantSchema,
    dwellSeconds: count,
    /** Shorter than the event's minimum share of the session: shown, never attributed. */
    tooShort: z.boolean(),
    attributed: z.boolean(),
  })
  .strict();
export const attendanceMovementSchema = z
  .object({
    person: z.object(personFields).strict(),
    firstCheckInAt: utcInstantSchema,
    stays: z.array(sessionStaySchema),
  })
  .strict();
export type AttendanceMovement = z.infer<typeof attendanceMovementSchema>;
export const attendanceMovementsResponseSchema = paginatedResponseSchema("people", attendanceMovementSchema).extend({
  minimumStayPercent,
});
