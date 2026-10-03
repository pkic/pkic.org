import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { utcInstantSchema } from "./api-common";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";

export const sessionParticipationRequestSchema = z
  .object({
    attendanceMode: z.enum(["physical", "remote"]),
    action: z.enum(["save", "reserve", "request", "cancel"]),
  })
  .strict();
export const sessionParticipationStatusSchema = z.enum([
  "saved",
  "reserved",
  "approval_pending",
  "waitlisted",
  "canceled",
]);
export const sessionParticipationResponseSchema = z.object({
  status: sessionParticipationStatusSchema,
  attendanceMode: z.enum(["physical", "remote"]),
});
export const scanActionSchema = z.enum(["check", "attendance", "exception", "lead"]);
export const scanReasonSchema = z.enum([
  "consent_required",
  "wrong_attendance_mode",
  "eligible",
  "missing_registration",
  "canceled_registration",
  "revoked_badge",
  "unknown_credential",
  "capacity",
  "exception",
  "verification_required",
]);
export const scanOutcomeSchema = z.enum(["eligible", "warning", "denied", "unknown", "unverified"]);
export const eventScanRequestSchema = z
  .object({
    operatorUserId: databaseIdSchema,
    operationId: databaseIdSchema,
    deviceId: databaseIdSchema,
    badgeId: databaseIdSchema,
    occurrenceId: databaseIdSchema.nullable(),
    action: scanActionSchema,
    observedAt: utcInstantSchema,
    exceptionReason: z.enum(["organizer_approval", "registration_correction", "accessibility_support"]).optional(),
    sponsorId: databaseIdSchema.optional(),
    consentConfirmed: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.action === "exception" && !value.exceptionReason)
      context.addIssue({ code: "custom", path: ["exceptionReason"], message: "Choose an exception reason." });
    if (value.action === "lead" && (!value.sponsorId || value.consentConfirmed !== true))
      context.addIssue({
        code: "custom",
        path: ["consentConfirmed"],
        message: "Confirm the attendee agrees to share their contact details with this sponsor.",
      });
  });
export const eventScanResponseSchema = z
  .object({
    operationId: databaseIdSchema,
    outcome: scanOutcomeSchema,
    reason: scanReasonSchema,
    recorded: z.boolean(),
    attendanceRecorded: z.boolean(),
  })
  .strict();
/** This is the only record persisted on a scanning device. Strict parsing rejects profile data. */
export const offlineScanRecordSchema = z
  .object({
    eventId: z.string().min(1).max(200),
    scan: eventScanRequestSchema,
  })
  .strict();
export type EventScanRequest = z.infer<typeof eventScanRequestSchema>;
export type EventScanResponse = z.infer<typeof eventScanResponseSchema>;
export type OfflineScanRecord = z.infer<typeof offlineScanRecordSchema>;
export const scannerTargetQuerySchema = listQuerySchema(["title"] as const);
export const scannerTargetSchema = z.object({ id: databaseIdSchema, title: z.string() });
export const scannerTargetsResponseSchema = paginatedResponseSchema("sessions", scannerTargetSchema);

export type ScannerTarget = z.infer<typeof scannerTargetSchema>;
export type ScannerTargetsResponse = z.infer<typeof scannerTargetsResponseSchema>;
