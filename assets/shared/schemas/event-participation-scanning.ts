import { badgeCredentialSchema } from "./badge-credential";
import { scannerAdmissionDecisionSchema } from "./event-scanner-admission";
import { offlineAdmissionRightSchema } from "./event-offline-rights";
import { attendanceCaptureRequestFieldsSchema, refineAttendanceCaptureIntent } from "./event-attendance-capture";
import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { utcInstantSchema } from "./api-common";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import { scannerSessionSchema, scannerReceiptSchema } from "./event-scanner-devices";

/** Server-owned calendar/manager commands reuse the fields without a displayed-page assertion. */
export const sessionParticipationCommandSchema = z
  .object({
    expectedPublishedRevision: z.number().int().nonnegative().optional(),
    roomId: databaseIdSchema.nullable().optional(),
    attendanceMode: z.enum(["physical", "remote"]),
    action: z.enum(["save", "unsave", "reserve", "request", "cancel"]),
    replaceOccurrenceId: databaseIdSchema.optional(),
  })
  .strict();
export const sessionParticipationRequestSchema = sessionParticipationCommandSchema.refine(
  (value) => !["reserve", "request"].includes(value.action) || value.expectedPublishedRevision !== undefined,
  {
    path: ["expectedPublishedRevision"],
    message: "Refresh the published agenda before reserving or requesting a place.",
  },
);
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
export const scanActionSchema = z.enum(["check", "admission", "attendance", "checkout", "exception", "lead"]);
export const scanReasonSchema = z.enum([
  "contact_retention_expired",
  "consent_required",
  "wrong_attendance_mode",
  "wrong_location",
  "eligible",
  "missing_registration",
  "canceled_registration",
  "revoked_badge",
  "expired_badge",
  "unknown_credential",
  "capacity",
  "exception",
  "verification_required",
]);
export const scanOutcomeSchema = z.enum(["eligible", "warning", "denied", "unknown", "unverified"]);
const eventScanRequestFieldsSchema = z
  .object({
    operatorUserId: databaseIdSchema,
    scannerSession: scannerSessionSchema.optional(),
    ...attendanceCaptureRequestFieldsSchema.shape,
    operationId: databaseIdSchema,
    deviceId: databaseIdSchema,
    badgeId: badgeCredentialSchema,
    occurrenceId: databaseIdSchema.nullable(),
    roomId: databaseIdSchema.nullable().optional(),
    action: scanActionSchema,
    observedAt: utcInstantSchema,
    offlineRight: offlineAdmissionRightSchema.optional(),
    recordAttendance: z.boolean().optional(),
    exceptionReason: z.enum(["organizer_approval", "registration_correction", "accessibility_support"]).optional(),
    sponsorId: databaseIdSchema.optional(),
    consentConfirmed: z.boolean().optional(),
  })
  .strict();

function refineScanIntent(value: z.infer<typeof eventScanRequestFieldsSchema>, context: z.RefinementCtx) {
  refineAttendanceCaptureIntent(value, context);
  if (
    value.offlineRight &&
    value.action !== "attendance" &&
    value.action !== "admission" &&
    value.action !== "exception"
  )
    context.addIssue({
      code: "custom",
      path: ["offlineRight"],
      message: "Offline admission rights require an admission, attendance or exception operation.",
    });
  if (
    value.action === "checkout" &&
    (value.exceptionReason !== undefined ||
      value.sponsorId !== undefined ||
      value.consentConfirmed !== undefined ||
      value.recordAttendance !== undefined)
  )
    context.addIssue({
      code: "custom",
      path: ["action"],
      message: "Checkout records departure only.",
    });
  if (value.recordAttendance && value.action !== "exception")
    context.addIssue({
      code: "custom",
      path: ["recordAttendance"],
      message: "Record attendance with attendance mode or an explicit exception confirmation.",
    });
  if (value.action === "exception" && !value.exceptionReason)
    context.addIssue({
      code: "custom",
      path: ["exceptionReason"],
      message: "Choose an exception reason.",
    });
  if (value.action === "lead" && (!value.sponsorId || value.consentConfirmed !== true))
    context.addIssue({
      code: "custom",
      path: ["consentConfirmed"],
      message: "Confirm the attendee agrees to share their contact details with this sponsor.",
    });
}
export const eventScanRequestSchema = eventScanRequestFieldsSchema.superRefine(refineScanIntent);
/** User capture fields are validated before the IndexedDB allocator supplies the immutable sequence. */
export const eventScanCaptureIntentSchema = eventScanRequestFieldsSchema
  .omit({ scannerSession: true })
  .superRefine(refineScanIntent);

export const eventScanResponseSchema = z
  .object({
    operationId: databaseIdSchema,
    outcome: scanOutcomeSchema,
    scannerReceipt: scannerReceiptSchema.optional(),
    reason: scanReasonSchema,
    recorded: z.boolean(),
    attendanceRecorded: z.boolean(),
    checkoutRecorded: z.boolean().optional(),
    /** True means a durable decision exists, including refused or unresolved decisions. */
    admissionRecorded: z.boolean().optional(),
    /** Omission on historical immutable receipts is preserved; null means no decision recorded. */
    admissionDecision: scannerAdmissionDecisionSchema.nullable().optional(),
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
/** Historical stored evidence may lack enrollment; every new HTTP upload must have it. */
export const enrolledEventScanRequestSchema = eventScanRequestSchema.safeExtend({
  scannerSession: scannerSessionSchema,
});
export type EnrolledEventScanRequest = z.infer<typeof enrolledEventScanRequestSchema>;
export const enrolledEventScanResponseSchema = eventScanResponseSchema.extend({
  scannerReceipt: scannerReceiptSchema,
});
export type EventScanResponse = z.infer<typeof eventScanResponseSchema>;
export type OfflineScanRecord = z.infer<typeof offlineScanRecordSchema>;
export const scannerTargetQuerySchema = listQuerySchema(["title"] as const).extend({
  occurrenceId: databaseIdSchema.optional(),
});
export const scannerTargetSchema = z.object({
  id: databaseIdSchema,
  title: z.string(),
  rooms: z
    .array(z.object({ id: databaseIdSchema, name: z.string() }))
    .max(20)
    .optional(),
});
export const scannerTargetsResponseSchema = paginatedResponseSchema("sessions", scannerTargetSchema);

export type ScannerTarget = z.infer<typeof scannerTargetSchema>;
export type ScannerTargetsResponse = z.infer<typeof scannerTargetsResponseSchema>;
/** The same approved location policy validates portal input and the authoritative scanner use case. */
function scanSchemaForRooms<T extends z.ZodType<EventScanRequest>>(schema: T, roomIds: readonly string[]) {
  return schema.superRefine((value, context) => {
    if (value.occurrenceId && roomIds.length > 1 && !value.roomId)
      context.addIssue({
        code: "custom",
        path: ["roomId"],
        message: "Choose the physical room where this badge is scanned.",
      });
    if (value.roomId && (!value.occurrenceId || !roomIds.includes(value.roomId)))
      context.addIssue({
        code: "custom",
        path: ["roomId"],
        message: "Choose a room reserved for this session.",
      });
  });
}

export function eventScanRequestForRoomsSchema(roomIds: readonly string[]) {
  return scanSchemaForRooms(eventScanRequestSchema, roomIds);
}
export function eventScanCaptureIntentForRoomsSchema(roomIds: readonly string[]) {
  return scanSchemaForRooms(eventScanCaptureIntentSchema, roomIds);
}
export function enrolledEventScanRequestForRoomsSchema(roomIds: readonly string[]) {
  return scanSchemaForRooms(enrolledEventScanRequestSchema, roomIds);
}
