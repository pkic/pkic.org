/**
 * Transport contracts for attendee self check-in: the check-in codes
 * organizers download for print or show on screen, what scanning one does, and the live
 * on-site counts per day. Policy lives in `../attendance-points.ts`.
 */
import { z } from "zod";
import {
  attendancePointSelectionSchema,
  attendancePointKindSchema,
  attendancePointRefusalSchema,
  attendancePointStatusSchema,
  attendeeStandingSchema,
} from "../attendance-points";
import { clockCitySchema } from "../event-clock";
import { eventSlugParamsSchema, utcInstantSchema } from "./api-common";
import { eventDayDateSchema } from "./event-read-models";
import { timeZoneSchema } from "./event-series";
import { databaseIdSchema } from "./identifiers";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";

const count = z.number().int().nonnegative();

/** A signed point code as it appears in a check-in link: never a person, only the point. */
export const attendancePointTokenSchema = z
  .string()
  .trim()
  .min(16)
  .max(512)
  .regex(/^pkc1_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, "This check-in code is not valid.");

export const attendancePointTokenParamsSchema = eventSlugParamsSchema.extend({
  pointToken: attendancePointTokenSchema,
});

const pointRoomSchema = z.object({ id: databaseIdSchema, name: z.string() }).strict();
const pointSessionSchema = z
  .object({
    id: databaseIdSchema,
    title: z.string(),
    startAt: utcInstantSchema,
    endAt: utcInstantSchema,
    room: pointRoomSchema.nullable(),
  })
  .strict();

/** One check-in code: what it is for, its signed code and the portal path a phone camera opens. */
export const attendancePointSchema = z
  .object({
    kind: attendancePointKindSchema,
    /** A short name for the code: "Day 1 check-in", "Main hall", the session title. */
    label: z.string(),
    dayDate: eventDayDateSchema.nullable(),
    dayLabel: z.string().nullable(),
    room: pointRoomSchema.nullable(),
    session: pointSessionSchema.nullable(),
    token: attendancePointTokenSchema,
    /** Portal-relative path the QR code opens (`/portal/#/events/…/check-in/…`). */
    path: z.string().startsWith("/portal/#/events/"),
  })
  .strict();
export type AttendancePoint = z.infer<typeof attendancePointSchema>;

/**
 * A check-in code on a broadcast or room output: which point (the shared
 * selection), and the name and signed link the room resolved for it. The
 * room resolves the selection itself; it never takes a link from a client.
 */
export const liveCheckInGraphicSchema = z
  .object({
    selection: attendancePointSelectionSchema,
    label: attendancePointSchema.shape.label,
    path: attendancePointSchema.shape.path,
  })
  .strict();
export type LiveCheckInGraphic = z.infer<typeof liveCheckInGraphicSchema>;

/**
 * Venue and room codes by default; session codes when `kind=session`. Each
 * filter narrows the derived set the server builds from event days, rooms and
 * published sessions.
 */
export const attendancePointsQuerySchema = listQuerySchema(["label"] as const).extend({
  kind: attendancePointKindSchema.optional(),
  dayDate: eventDayDateSchema.optional(),
  roomId: databaseIdSchema.optional(),
  occurrenceId: databaseIdSchema.optional(),
});
export type AttendancePointsQuery = z.infer<typeof attendancePointsQuerySchema>;

/**
 * Download codes as SVG for poster designs made elsewhere: `svg` for the one
 * code the filter selects, `zip` (the default) for every code it selects, one SVG each. The
 * filter is the listing's, so the codes downloaded are the codes listed.
 */
export const attendancePointExportQuerySchema = attendancePointsQuerySchema
  .pick({ q: true, kind: true, dayDate: true, roomId: true, occurrenceId: true })
  .extend({ format: z.enum(["svg", "zip"]).default("zip") });

export const attendancePointsResponseSchema = paginatedResponseSchema("points", attendancePointSchema).extend({
  timeZone: timeZoneSchema,
  clockCity: clockCitySchema,
  /** When the current codes were issued; codes downloaded or printed before this no longer work. */
  issuedAt: utcInstantSchema,
  /** Whether the reader may reissue the codes. */
  canReissue: z.boolean(),
});
export type AttendancePointsResponse = z.infer<typeof attendancePointsResponseSchema>;

export const attendancePointIssuanceResponseSchema = z.object({ issuedAt: utcInstantSchema }).strict();

/** What scanning the point does: check in to a day or a session, or check out of the venue. */
export const attendancePointTargetSchema = z
  .object({
    action: z.enum(["check_in", "check_out"]),
    kind: attendancePointKindSchema,
    dayDate: eventDayDateSchema,
    dayLabel: z.string(),
    room: pointRoomSchema.nullable(),
    session: pointSessionSchema.nullable(),
    timeZone: timeZoneSchema,
    clockCity: clockCitySchema,
  })
  .strict();
export type AttendancePointTarget = z.infer<typeof attendancePointTargetSchema>;

/**
 * The same result reads a code (status `ready` or an outcome known in advance)
 * and records it. `target` is null only when the code could not be read. A
 * check-in is never refused for the person's standing or booking; both are
 * reported so the attendee knows how they were recorded.
 */
export const attendancePointResultSchema = z
  .object({
    status: attendancePointStatusSchema,
    reason: attendancePointRefusalSchema.nullable(),
    target: attendancePointTargetSchema.nullable(),
    recordedAt: utcInstantSchema.nullable(),
    /**
     * Where the person stands for the day, recorded with the check-in and told
     * to them. Null when the scan is refused.
     */
    standing: attendeeStandingSchema.nullable(),
    /**
     * For a session: whether the person holds the place it asks for (always
     * true when it needs no booking). Null for venue codes and refusals.
     */
    booked: z.boolean().nullable(),
  })
  .strict();
export type AttendancePointResult = z.infer<typeof attendancePointResultSchema>;

/** The attendee confirms a scanned point; the operation ID makes a retried request safe. */
export const attendancePointCommandSchema = z
  .object({ pointToken: attendancePointTokenSchema, operationId: z.uuid() })
  .strict();
export type AttendancePointCommand = z.infer<typeof attendancePointCommandSchema>;

/** The signed-in attendee's own check-in state today, for the event home. */
export const currentAttendanceResponseSchema = z
  .object({
    dayDate: eventDayDateSchema.nullable(),
    dayLabel: z.string().nullable(),
    venue: z.enum(["none", "checked_in", "checked_out"]),
    changedAt: utcInstantSchema.nullable(),
    lastSession: z.object({ title: z.string(), checkedInAt: utcInstantSchema }).strict().nullable(),
    timeZone: timeZoneSchema,
    clockCity: clockCitySchema,
  })
  .strict();
export type CurrentAttendance = z.infer<typeof currentAttendanceResponseSchema>;

export const attendanceOccupancyQuerySchema = listQuerySchema(["dayDate"] as const).extend({
  dayDate: eventDayDateSchema.optional(),
});

/** Venue counts per day from staff badge scans and attendee self check-ins together. */
export const attendanceOccupancyDaySchema = z
  .object({
    dayDate: eventDayDateSchema,
    dayLabel: z.string(),
    capacity: count.nullable(),
    checkedIn: count,
    checkedOut: count,
    onSite: count,
    available: count.nullable(),
    selfCheckIns: count,
    staffCheckIns: count,
  })
  .strict();
export const attendanceOccupancyResponseSchema = paginatedResponseSchema("days", attendanceOccupancyDaySchema).extend({
  generatedAt: utcInstantSchema,
  timeZone: timeZoneSchema,
  clockCity: clockCitySchema,
});
export type AttendanceOccupancyResponse = z.infer<typeof attendanceOccupancyResponseSchema>;
