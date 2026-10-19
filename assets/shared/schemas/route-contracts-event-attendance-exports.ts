import { z } from "zod";
import { requiresPermissions } from "./route-contract";
import { eventSlugParamsSchema, jsonErrorResponse } from "./api-common";
import {
  attendancePeopleExportQuerySchema,
  attendanceAttemptsExportQuerySchema,
  attendanceSummaryExportQuerySchema,
} from "./event-attendance-exports";
const common = {
  ...requiresPermissions("agenda:attendance_read"),
  tags: ["Events"],
  responses: {
    "200": {
      description: "Complete bounded attendance CSV with explicit evidence limits",
      content: { "text/csv": { schema: z.string() } },
    },
    "403": jsonErrorResponse("Attendance reporting permission required"),
    "410": jsonErrorResponse("Event identity access has expired"),
    "413": jsonErrorResponse("Narrow the export scope to fit the documented limits"),
  },
};
export const attendancePeopleExportRouteSchema = {
  ...common,
  summary: "Export observed people and separate participation intent",
  request: { params: eventSlugParamsSchema, query: attendancePeopleExportQuerySchema },
};
export const attendanceAttemptsExportRouteSchema = {
  ...common,
  summary: "Export recognized scan attempts separately from presence",
  request: { params: eventSlugParamsSchema, query: attendanceAttemptsExportQuerySchema },
};
export const attendanceSummaryExportRouteSchema = {
  ...common,
  summary: "Export aggregate attendance with synchronization and clock uncertainty",
  request: { params: eventSlugParamsSchema, query: attendanceSummaryExportQuerySchema },
};
