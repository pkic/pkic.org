import { requiresPermissions } from "./route-contract";
import { eventSlugParamsSchema, jsonErrorResponse } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import {
  attendanceCorrectionRequestSchema,
  attendanceCorrectionSchema,
  attendanceEvidenceQuerySchema,
  attendanceEvidenceResponseSchema,
  attendanceCorrectionHistoryQuerySchema,
  attendanceCorrectionHistoryResponseSchema,
} from "./event-attendance-corrections";
const params = eventSlugParamsSchema.extend({ observationId: databaseIdSchema });
export const attendanceEvidenceRouteSchema = {
  ...requiresPermissions("agenda:attendance_read"),
  tags: ["Events"],
  summary: "Read original attendance evidence and effective corrections",
  request: { params: eventSlugParamsSchema, query: attendanceEvidenceQuerySchema },
  responses: {
    "200": {
      description: "Bounded evidence",
      content: { "application/json": { schema: attendanceEvidenceResponseSchema } },
    },
    "403": jsonErrorResponse("Attendance scope required"),
  },
};
export const attendanceCorrectionHistoryRouteSchema = {
  ...requiresPermissions("agenda:attendance_read"),
  tags: ["Events"],
  summary: "Read attributable attendance correction history",
  request: { params, query: attendanceCorrectionHistoryQuerySchema },
  responses: {
    "200": {
      description: "Bounded correction history",
      content: { "application/json": { schema: attendanceCorrectionHistoryResponseSchema } },
    },
    "403": jsonErrorResponse("Attendance scope required"),
  },
};
export const attendanceCorrectionCreateRouteSchema = {
  ...requiresPermissions("agenda:attendance_correct"),
  tags: ["Events"],
  summary: "Void or restore attendance evidence without changing the original observation",
  request: {
    params,
    body: { content: { "application/json": { schema: attendanceCorrectionRequestSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Attributable correction",
      content: { "application/json": { schema: attendanceCorrectionSchema } },
    },
    "403": jsonErrorResponse("Correction scope required"),
    "409": jsonErrorResponse("Evidence changed; reload before correcting"),
  },
};
