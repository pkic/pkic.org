import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { utcInstantSchema, eventSlugParamsSchema, jsonErrorResponse } from "./api-common";
import { scannerSessionSchema } from "./event-scanner-devices";
import { scannedAttemptCaptureSchema, scannerFailureReasonSchema } from "./scanner-attempt-capture";
import { scanActionSchema, enrolledEventScanResponseSchema } from "./event-participation-scanning";
import { requiresAnyPermissions } from "./route-contract";

/** A local refusal is evidence only: it carries no interpreted badge identity or attendance assertion. */
const scannerFailureFieldsSchema = scannedAttemptCaptureSchema
  .extend({
    operationId: databaseIdSchema,
    operatorUserId: databaseIdSchema,
    deviceId: databaseIdSchema,
    scannerSession: scannerSessionSchema,
    occurrenceId: databaseIdSchema.nullable(),
    roomId: databaseIdSchema.nullable().optional(),
    sponsorId: databaseIdSchema.optional(),
    action: scanActionSchema,
    observedAt: utcInstantSchema,
    reason: scannerFailureReasonSchema,
  })
  .strict();
function refineFailureIntent(value: { action: string; sponsorId?: string }, context: z.RefinementCtx) {
  if (value.action === "lead" && value.sponsorId === undefined)
    context.addIssue({
      code: "custom",
      path: ["sponsorId"],
      message: "Identify the sponsor whose scanner captured this attempt.",
    });
}
export const scannerFailureRequestSchema = scannerFailureFieldsSchema.superRefine(refineFailureIntent);
/** Validated capture before the single device ledger allocates its epoch sequence. */
export const scannerFailureCaptureSchema = scannerFailureFieldsSchema
  .omit({ scannerSession: true })
  .superRefine(refineFailureIntent);
export type ScannerFailureRequest = z.infer<typeof scannerFailureRequestSchema>;
export const scannerFailureRouteSchema = {
  ...requiresAnyPermissions(
    ["agenda:scan"],
    ["agenda:check"],
    ["agenda:admit"],
    ["agenda:attendance_record"],
    ["agenda:leads_capture"],
  ),
  tags: ["Events"],
  summary: "Record an enrolled scanner's local refusal without recording attendance",
  request: {
    params: eventSlugParamsSchema,
    body: { content: { "application/json": { schema: scannerFailureRequestSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Immutable attempt and device receipt",
      content: { "application/json": { schema: enrolledEventScanResponseSchema } },
    },
    "400": jsonErrorResponse("Invalid attempt metadata"),
    "403": jsonErrorResponse("Scanning permission required"),
  },
};
