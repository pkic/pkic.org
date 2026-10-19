import { requiresPermissions } from "./route-contract";
import { eventSlugParamsSchema, jsonErrorResponse } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import {
  attendanceQuerySchema,
  attendanceReportSchema,
  leadCaptureRequestSchema,
  leadCaptureResponseSchema,
  attendancePeopleQuerySchema,
  attendancePeopleResponseSchema,
} from "./event-participation-reporting";
export const eventAttendanceRouteSchema = {
  ...requiresPermissions("agenda:attendance_read"),
  tags: ["Events"],
  summary: "Report observed session attendance",
  request: { params: eventSlugParamsSchema, query: attendanceQuerySchema },
  responses: {
    "200": {
      description: "Attendance by session",
      content: { "application/json": { schema: attendanceReportSchema } },
    },
    "403": jsonErrorResponse("Attendance reporting permission required"),
  },
};
export const eventSponsorLeadRouteSchema = {
  ...requiresPermissions("agenda:leads_capture"),
  tags: ["Events"],
  summary: "Capture a consented sponsor lead",
  request: {
    params: eventSlugParamsSchema.extend({ sponsorId: databaseIdSchema }),
    body: { content: { "application/json": { schema: leadCaptureRequestSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Lead capture decision",
      content: { "application/json": { schema: leadCaptureResponseSchema } },
    },
    "403": jsonErrorResponse("Sponsor-specific scanning grant required"),
  },
};
export const sessionAttendancePeopleRouteSchema = {
  ...requiresPermissions("agenda:attendance_read"),
  tags: ["Events"],
  summary: "List observed attendees for a session",
  request: {
    params: eventSlugParamsSchema.extend({ occurrenceId: databaseIdSchema }),
    query: attendancePeopleQuerySchema,
  },
  responses: {
    "200": {
      description: "Observed attendees, with live authorized identity display",
      content: { "application/json": { schema: attendancePeopleResponseSchema } },
    },
    "403": jsonErrorResponse("Attendance reporting permission required"),
  },
};
