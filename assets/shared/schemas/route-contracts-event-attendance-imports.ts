import { requiresPermissions } from "./route-contract";
import { eventSlugParamsSchema, jsonErrorResponse } from "./api-common";
import {
  attendanceImportRequestSchema,
  attendanceImportReviewSchema,
  attendanceImportApplySchema,
  attendanceImportReceiptSchema,
  attendanceImportsQuerySchema,
  attendanceImportsResponseSchema,
} from "./event-attendance-imports";
export const attendanceImportReviewRouteSchema = {
  ...requiresPermissions("agenda:attendance_import"),
  tags: ["Events"],
  summary: "Review bounded attendance evidence without recording presence",
  request: {
    params: eventSlugParamsSchema,
    body: { required: true, content: { "application/json": { schema: attendanceImportRequestSchema } } },
  },
  responses: {
    "200": {
      description: "Actor-bound review",
      content: { "application/json": { schema: attendanceImportReviewSchema } },
    },
    "403": jsonErrorResponse("Import scope required"),
    "422": jsonErrorResponse("Evidence invalid"),
  },
};
export const attendanceImportApplyRouteSchema = {
  ...requiresPermissions("agenda:attendance_import"),
  tags: ["Events"],
  summary: "Apply reviewed attendance evidence with retained provenance",
  request: {
    params: eventSlugParamsSchema,
    body: { required: true, content: { "application/json": { schema: attendanceImportApplySchema } } },
  },
  responses: {
    "200": {
      description: "Import receipt",
      content: { "application/json": { schema: attendanceImportReceiptSchema } },
    },
    "403": jsonErrorResponse("Import scope required"),
    "409": jsonErrorResponse("Review changed or source record already imported"),
  },
};
export const attendanceImportsRouteSchema = {
  ...requiresPermissions("agenda:attendance_read"),
  tags: ["Events"],
  summary: "Read bounded attendance import provenance",
  request: { params: eventSlugParamsSchema, query: attendanceImportsQuerySchema },
  responses: {
    "200": {
      description: "Import history",
      content: { "application/json": { schema: attendanceImportsResponseSchema } },
    },
    "403": jsonErrorResponse("Attendance read scope required"),
  },
};
