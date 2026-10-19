import { z } from "zod";
import { eventSlugParamsSchema, jsonErrorResponse } from "./api-common";
import {
  attendanceOccupancyQuerySchema,
  attendanceOccupancyResponseSchema,
  attendancePointCommandSchema,
  attendancePointExportQuerySchema,
  attendancePointIssuanceResponseSchema,
  attendancePointResultSchema,
  attendancePointsQuerySchema,
  attendancePointsResponseSchema,
  attendancePointTokenParamsSchema,
  currentAttendanceResponseSchema,
} from "./event-attendance-points";
import {
  attendanceAttributionsQuerySchema,
  attendanceAttributionsResponseSchema,
  attendanceMovementsQuerySchema,
  attendanceMovementsResponseSchema,
  selfCheckInsQuerySchema,
  selfCheckInsResponseSchema,
} from "./event-attendance-movement";
import { authErrors, created, ok, requiresPermissions, requiresSession } from "./route-contract";

const commandBody = {
  content: { "application/json": { schema: attendancePointCommandSchema } },
  required: true,
} as const;

export const attendancePointsRouteSchema = {
  ...requiresPermissions("agenda:attendance_read"),
  tags: ["Events"],
  summary: "List the event's check-in codes",
  description:
    "Derived from event days, agenda rooms and published sessions. Each code is signed with the event's current " +
    "check-in key and names only the point, never a person.",
  request: { params: eventSlugParamsSchema, query: attendancePointsQuerySchema },
  responses: {
    ...ok("Check-in codes", attendancePointsResponseSchema),
    ...authErrors({ notFound: "Event unavailable", conflict: "Check-in codes are unavailable" }),
  },
};

export const attendancePointExportRouteSchema = {
  ...requiresPermissions("agenda:attendance_read"),
  tags: ["Events"],
  summary: "Download check-in codes as SVG",
  description:
    "`format=svg` returns the one static code the filter selects as an SVG file; `format=zip` returns every code " +
    "the filter selects, one SVG each. Each SVG holds only the QR code, for posters designed elsewhere.",
  request: { params: eventSlugParamsSchema, query: attendancePointExportQuerySchema },
  responses: {
    200: {
      description: "One SVG, or a ZIP of SVG files",
      content: { "image/svg+xml": { schema: z.string() }, "application/zip": { schema: z.string() } },
    },
    ...authErrors({ badRequest: "The filter does not select exactly one code", notFound: "No codes to download" }),
    "413": jsonErrorResponse("Too many codes at once"),
  },
};

export const attendancePointIssuanceRouteSchema = {
  ...requiresPermissions("agenda:write"),
  tags: ["Events"],
  summary: "Reissue the event's check-in codes",
  description: "Rotates the event's check-in key. Every code printed or shown before stops working.",
  request: { params: eventSlugParamsSchema },
  responses: {
    ...created("New codes issued", attendancePointIssuanceResponseSchema),
    ...authErrors({ notFound: "Event unavailable" }),
  },
};

export const attendancePointReadRouteSchema = {
  ...requiresSession(),
  tags: ["Events"],
  summary: "Read what scanning a check-in code does for the signed-in attendee",
  request: { params: attendancePointTokenParamsSchema },
  responses: {
    ...ok("What the code does now, or why it does not apply", attendancePointResultSchema),
    ...authErrors({ badRequest: "Invalid code", notFound: "Event unavailable" }),
  },
};

export const attendanceCheckInCreateRouteSchema = {
  ...requiresSession(),
  tags: ["Events"],
  summary: "Check the signed-in attendee in to a day or a session",
  description:
    "Idempotent: scanning again reports the existing check-in. A refusal is a result, not an error, so the " +
    "attendee sees why.",
  request: { params: eventSlugParamsSchema, body: commandBody },
  responses: {
    ...ok("Check-in result", attendancePointResultSchema),
    ...authErrors({ badRequest: "Invalid code", notFound: "Event unavailable", conflict: "Operation ID reused" }),
  },
};

export const attendanceCheckOutCreateRouteSchema = {
  ...requiresSession(),
  tags: ["Events"],
  summary: "Check the signed-in attendee out of the venue",
  description:
    "Valid only while checked in on that day. Lowers the day's on-site count; it never changes a registration " +
    "or a waiting list.",
  request: { params: eventSlugParamsSchema, body: commandBody },
  responses: {
    ...ok("Check-out result", attendancePointResultSchema),
    ...authErrors({ badRequest: "Invalid code", notFound: "Event unavailable", conflict: "Operation ID reused" }),
  },
};

export const currentAttendanceRouteSchema = {
  ...requiresSession(),
  tags: ["Events"],
  summary: "Read the signed-in attendee's own check-in state today",
  request: { params: eventSlugParamsSchema },
  responses: {
    ...ok("Today's check-in state", currentAttendanceResponseSchema),
    ...authErrors({ notFound: "Event unavailable" }),
  },
};

export const attendanceOccupancyRouteSchema = {
  ...requiresPermissions("agenda:attendance_read"),
  tags: ["Events"],
  summary: "Count checked-in, checked-out and on-site people per day",
  request: { params: eventSlugParamsSchema, query: attendanceOccupancyQuerySchema },
  responses: {
    ...ok("On-site counts per day", attendanceOccupancyResponseSchema),
    ...authErrors({ notFound: "Event unavailable" }),
  },
};

export const selfCheckInsRouteSchema = {
  ...requiresPermissions("agenda:attendance_read"),
  tags: ["Events"],
  summary: "List self check-ins with each person's standing",
  description:
    "Every self check-in is recorded, including people who were not registered, had no in-person place or had " +
    "no seat booked; `expected=no` lists exactly those. Remote check-ins carry the `remote` standing.",
  request: { params: eventSlugParamsSchema, query: selfCheckInsQuerySchema },
  responses: {
    ...ok("Self check-ins", selfCheckInsResponseSchema),
    ...authErrors({ notFound: "Event unavailable", gone: "Contact access for this event has ended" }),
  },
};

export const attendanceAttributionsRouteSchema = {
  ...requiresPermissions("agenda:attendance_read"),
  tags: ["Events"],
  summary: "Count each session's in-person attendance after attribution",
  description:
    "A person checked in to overlapping sessions is attributed to the one they stayed in longest. Stays run from " +
    "a check-in to the next check-in elsewhere, a check-out or the session's end, within the session's own times.",
  request: { params: eventSlugParamsSchema, query: attendanceAttributionsQuerySchema },
  responses: {
    ...ok("Sessions with attributed attendance", attendanceAttributionsResponseSchema),
    ...authErrors({ notFound: "Event unavailable", conflict: "Too many check-ins to attribute at once" }),
  },
};

export const attendanceMovementsRouteSchema = {
  ...requiresPermissions("agenda:attendance_read"),
  tags: ["Events"],
  summary: "List each person's in-person movement between sessions",
  request: { params: eventSlugParamsSchema, query: attendanceMovementsQuerySchema },
  responses: {
    ...ok("People with their session stays", attendanceMovementsResponseSchema),
    ...authErrors({
      notFound: "Event unavailable",
      conflict: "Too many check-ins to attribute at once",
      gone: "Contact access for this event has ended",
    }),
  },
};
