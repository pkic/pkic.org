import { attendanceCaptureTimeZoneSchema } from "./event-attendance-capture";
import { eventDayDateSchema } from "./event-read-models";
import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { utcInstantSchema } from "./api-common";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
export const attendanceImportTextSchema = z.object({ evidence: z.string().trim().min(1).max(100_000) }).strict();
/** Imported presence is a reviewed assertion, never a camera/admission decision. */
export const attendanceImportRowSchema = z
  .object({
    sourceRecordId: z.string().trim().min(1).max(120),
    userId: databaseIdSchema,
    occurrenceId: databaseIdSchema.nullable(),
    attendanceMode: z.enum(["physical", "virtual"]),
    observedAt: utcInstantSchema,
    verification: z.enum(["unverified", "provider_verified"]),
  })
  .strict();
export const attendanceImportRequestSchema = z
  .object({
    operationId: databaseIdSchema,
    source: z.enum(["vendor_attendance", "manual_evidence"]),
    sourceReference: z.string().trim().min(1).max(200),
    rows: z.array(attendanceImportRowSchema).min(1).max(100),
  })
  .strict()
  .superRefine((value, ctx) => {
    const keys = new Set<string>();
    value.rows.forEach((row, index) => {
      if (keys.has(row.sourceRecordId))
        ctx.addIssue({
          code: "custom",
          path: ["rows", index, "sourceRecordId"],
          message: "Source record identifiers must be unique.",
        });
      keys.add(row.sourceRecordId);
      if (value.source === "manual_evidence" && row.verification !== "unverified")
        ctx.addIssue({
          code: "custom",
          path: ["rows", index, "verification"],
          message: "Manual evidence cannot claim provider verification.",
        });
    });
  });
export const attendanceImportContextSchema = z
  .object({
    timeZone: attendanceCaptureTimeZoneSchema,
    eventTimeZone: attendanceCaptureTimeZoneSchema,
    publicationRevision: z.number().int().nonnegative().nullable(),
    eventStartAt: utcInstantSchema.nullable(),
    eventEndAt: utcInstantSchema.nullable(),
    occurrences: z
      .array(z.object({ occurrenceId: databaseIdSchema, startAt: utcInstantSchema, endAt: utcInstantSchema }).strict())
      .max(100),
    capturedDays: z.array(eventDayDateSchema).min(1).max(100),
  })
  .strict();
export const attendanceImportReviewSchema = z.object({
  reviewId: databaseIdSchema,
  payloadHash: z.string(),
  captureContextHash: z.string().regex(/^[a-f0-9]{64}$/),
  captureContext: attendanceImportContextSchema,
  rowCount: z.number().int().positive(),
  reviewedAt: utcInstantSchema,
  expiresAt: utcInstantSchema,
});
export const attendanceImportApplySchema = z
  .object({
    operationId: databaseIdSchema,
    reviewId: databaseIdSchema,
    payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const attendanceImportReceiptSchema = z.object({
  id: databaseIdSchema,
  operationId: databaseIdSchema,
  reviewerUserId: databaseIdSchema,
  actorUserId: databaseIdSchema,
  source: z.enum(["vendor_attendance", "manual_evidence"]),
  sourceReference: z.string(),
  rowCount: z.number().int().nonnegative(),
  receivedAt: utcInstantSchema,
});
export const attendanceImportsQuerySchema = listQuerySchema(["receivedAt"] as const);
export const attendanceImportsResponseSchema = paginatedResponseSchema("imports", attendanceImportReceiptSchema);
