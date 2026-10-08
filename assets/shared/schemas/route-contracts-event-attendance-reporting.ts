import { requiresPermissions } from "./route-contract";
import { eventSlugParamsSchema, jsonErrorResponse } from "./api-common";
import {
  attendanceScopeQuerySchema,
  attendanceSummarySchema,
  attendanceAttemptQuerySchema,
  attendanceAttemptsResponseSchema,
  attendanceReasonsQuerySchema,
  attendanceReasonsResponseSchema,
  eventAttendancePeopleQuerySchema,
  eventAttendancePeopleResponseSchema,
} from "./event-attendance-reporting";
const common = {
  ...requiresPermissions("agenda:attendance_read"),
  tags: ["Events"],
};
export const attendanceSummaryRouteSchema = {
  ...common,
  summary: "Report event or day attendance and reconciliation evidence",
  request: { params: eventSlugParamsSchema, query: attendanceScopeQuerySchema },
  responses: {
    "200": {
      description: "Observed attendance with explicit evidence limits",
      content: { "application/json": { schema: attendanceSummarySchema } },
    },
    "403": jsonErrorResponse("Attendance reporting permission required"),
  },
};
export const attendanceAttemptsRouteSchema = {
  ...common,
  summary: "List recognized scan attempts separately from presence",
  request: { params: eventSlugParamsSchema, query: attendanceAttemptQuerySchema },
  responses: {
    "200": {
      description: "Bounded attributable attempt history",
      content: { "application/json": { schema: attendanceAttemptsResponseSchema } },
    },
    "403": jsonErrorResponse("Attendance reporting permission required"),
  },
};
export const attendanceReasonsRouteSchema = {
  ...common,
  summary: "Report scan decisions by structured reason",
  request: { params: eventSlugParamsSchema, query: attendanceReasonsQuerySchema },
  responses: {
    "200": {
      description: "Bounded scan reason counts",
      content: { "application/json": { schema: attendanceReasonsResponseSchema } },
    },
    "403": jsonErrorResponse("Attendance reporting permission required"),
  },
};
export const eventAttendancePeopleRouteSchema = {
  ...common,
  summary: "List people observed at an event or on a day",
  request: { params: eventSlugParamsSchema, query: eventAttendancePeopleQuerySchema },
  responses: {
    "200": {
      description: "Authorized live identity and observed participation",
      content: { "application/json": { schema: eventAttendancePeopleResponseSchema } },
    },
    "403": jsonErrorResponse("Attendance reporting permission required"),
  },
};
