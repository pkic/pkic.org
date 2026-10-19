import { z } from "zod";
import { eventSlugParamsSchema, jsonErrorResponse } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { requiresAnyPermissions } from "./route-contract";
import {
  scannerDeviceSessionEnrollmentSchema,
  scannerDeviceSessionEnrollmentResponseSchema,
  scannerDeviceSessionClosingSchema,
  scannerDeviceSessionStatusSchema,
} from "./event-scanner-devices";

const access = requiresAnyPermissions(
  ["agenda:scan"],
  ["agenda:check"],
  ["agenda:admit"],
  ["agenda:attendance_record"],
  ["agenda:leads_capture"],
);
const params = eventSlugParamsSchema.extend({ epochId: databaseIdSchema });
const response = (
  schema: typeof scannerDeviceSessionStatusSchema | typeof scannerDeviceSessionEnrollmentResponseSchema,
) => ({
  "200": { description: "Scanner session receipt", content: { "application/json": { schema } } },
  "403": jsonErrorResponse("Scanner permission required"),
  "409": jsonErrorResponse("Scanner lifecycle changed"),
});
export const scannerDeviceEnrollmentRouteSchema = {
  ...access,
  tags: ["Events"],
  summary: "Enroll an operator's scanner device epoch",
  request: {
    params: eventSlugParamsSchema,
    body: { content: { "application/json": { schema: scannerDeviceSessionEnrollmentSchema } }, required: true },
  },
  responses: response(scannerDeviceSessionEnrollmentResponseSchema),
};
export const scannerDeviceStatusRouteSchema = {
  ...access,
  tags: ["Events"],
  summary: "Read the scanner upload barrier",
  request: { params, query: z.object({ sponsorId: databaseIdSchema.optional() }) },
  responses: response(scannerDeviceSessionStatusSchema),
};
export const scannerDeviceClosingRouteSchema = {
  ...access,
  tags: ["Events"],
  summary: "Declare and reconcile the final issued scanner sequence",
  request: {
    params,
    body: { content: { "application/json": { schema: scannerDeviceSessionClosingSchema } }, required: true },
  },
  responses: response(scannerDeviceSessionStatusSchema),
};
