import { requiresAnyPermissions } from "./route-contract";
import { eventSlugParamsSchema, jsonErrorResponse } from "./api-common";
import {
  enrolledEventScanRequestSchema,
  enrolledEventScanResponseSchema,
  scannerTargetQuerySchema,
  scannerTargetsResponseSchema,
} from "./event-participation-scanning";
export const scannerTargetsRouteSchema = {
  ...requiresAnyPermissions(["agenda:scan"], ["agenda:check"], ["agenda:admit"], ["agenda:attendance_record"]),
  tags: ["Events"],
  summary: "List scanning session targets",
  request: { params: eventSlugParamsSchema, query: scannerTargetQuerySchema },
  responses: {
    "200": {
      description: "Session targets",
      content: { "application/json": { schema: scannerTargetsResponseSchema } },
    },
    "403": jsonErrorResponse("Scanning permission required"),
  },
};

export const eventScanCreateRouteSchema = {
  ...requiresAnyPermissions(
    ["agenda:scan"],
    ["agenda:check"],
    ["agenda:admit"],
    ["agenda:attendance_record"],
    ["agenda:leads_capture"],
  ),
  tags: ["Events"],
  summary: "Validate a badge and record a recognized scan attempt",
  request: {
    params: eventSlugParamsSchema,
    body: { content: { "application/json": { schema: enrolledEventScanRequestSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Scan decision and durable receipt",
      content: { "application/json": { schema: enrolledEventScanResponseSchema } },
    },
    "400": jsonErrorResponse("Invalid scan"),
    "401": jsonErrorResponse("Sign in required"),
    "403": jsonErrorResponse("Event scanning permission required"),
  },
};
