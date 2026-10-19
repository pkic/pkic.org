import { attendanceCaptureContextSchema } from "./event-attendance-capture";
import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { utcInstantSchema } from "./api-common";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
export const attendanceCorrectionRequestSchema = z
  .object({
    operationId: databaseIdSchema,
    expectedRevision: z.number().int().nonnegative(),
    kind: z.enum(["void", "restore"]),
    reasonCode: z.enum(["operator_error", "duplicate_observation", "attendee_dispute", "verified_evidence_review"]),
  })
  .strict();
export const attendanceCorrectionSchema = attendanceCorrectionRequestSchema.omit({ expectedRevision: true }).extend({
  id: databaseIdSchema,
  observationId: databaseIdSchema,
  actorUserId: databaseIdSchema,
  revision: z.number().int().positive(),
  createdAt: utcInstantSchema,
});
export const attendanceEvidenceQuerySchema = listQuerySchema(["observedAt"] as const).extend({
  occurrenceId: databaseIdSchema.optional(),
  userId: databaseIdSchema.optional(),
});
export const attendanceEvidenceSchema = z.object({
  id: databaseIdSchema,
  userId: databaseIdSchema,
  displayName: z.string().nullable(),
  occurrenceId: databaseIdSchema.nullable(),
  observedAt: utcInstantSchema,
  receivedAt: utcInstantSchema,
  operatorUserId: databaseIdSchema,
  deviceId: databaseIdSchema.nullable(),
  source: z.enum(["browser_scan", "offline_authorized_scan", "vendor_attendance", "manual_evidence"]),
  sourceReference: z.string().nullable().optional(),
  providerVerification: z.enum(["unverified", "provider_verified"]).optional(),
  attendanceMode: z.enum(["physical", "virtual"]).optional(),
  action: z.string(),
  deviceTimeVerified: z.literal(false),
  captureContext: attendanceCaptureContextSchema,
  revision: z.number().int().nonnegative(),
  voided: z.boolean(),
});
export const attendanceEvidenceResponseSchema = paginatedResponseSchema(
  "observations",
  attendanceEvidenceSchema,
).extend({ retentionPolicy: z.literal("retained_with_original_observation") });
export const attendanceCorrectionHistoryQuerySchema = listQuerySchema(["revision"] as const);
export const attendanceCorrectionHistoryResponseSchema = paginatedResponseSchema(
  "corrections",
  attendanceCorrectionSchema,
);
