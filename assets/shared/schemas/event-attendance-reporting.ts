import { scannerAdmissionDecisionSchema } from "./event-scanner-admission";
import { attendanceCaptureContextSchema } from "./event-attendance-capture";
import { eventContactRetentionSchema } from "./event-contact-retention";
import { z } from "zod";
import { scannerDeviceBacklogSchema, scannerReconciliationSchema } from "./event-scanner-reconciliation";
import { databaseIdSchema } from "./identifiers";
import { utcInstantSchema } from "./api-common";
import { eventDayDateSchema } from "./event-read-models";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
const count = z.number().int().nonnegative();
export const attendanceScopeQuerySchema = z.object({
  dayDate: eventDayDateSchema.optional(),
  occurrenceId: databaseIdSchema.optional(),
  attendanceMode: z.enum(["physical", "virtual"]).optional(),
});
export const attendanceSummarySchema = z.object({
  eventId: databaseIdSchema,
  timeZone: z.string(),
  dayDate: eventDayDateSchema.nullable(),
  occurrenceId: databaseIdSchema.nullable(),
  currentIntent: z.object({
    timeZone: z.string(),
    startAt: utcInstantSchema.nullable(),
    endAt: utcInstantSchema.nullable(),
    dayIntervalAvailable: z.boolean(),
  }),
  classification: z.object({
    basis: z.literal("captured_calendar_date"),
    missingObservations: count,
    missingAttempts: count,
    capturedTimeZones: count,
    mixedTimeZones: z.boolean(),
    dayFilterExcludesMissing: z.boolean(),
    missingScope: z.literal("event_occurrence_mode_without_day"),
  }),
  generatedAt: utcInstantSchema,
  observed: z.object({
    uniquePeople: count,
    physicalPeople: count,
    virtualPeople: count,
    providerAssertedVirtualPeople: count,
    originalObservations: count,
    effectiveObservations: count,
    voidedObservations: count,
    entryObservations: count,
    reentryObservations: count,
    checkoutObservations: count,
    importedObservations: count,
    offlineAuthorizedObservations: count,
  }),
  attempts: z.object({
    recognized: count,
    successful: count,
    unsuccessful: count,
    businessDenials: count,
    warnings: count,
    unverified: count,
    checks: count,
    admissions: count,
    admissionAllowed: count.optional(),
    admissionRefused: count.optional(),
    admissionUnresolved: count.optional(),
    admissionUnknown: count.optional(),
    uniqueAllowedAdmissionPeople: count.optional(),
    attendance: count,
    exceptions: count,
  }),
  sync: z.object({
    knownGrants: count,
    unclosedGrants: count,
    unclosedDevices: count,
    revokedUnclosedGrants: count,
    expiredUnclosedGrants: count,
    reconciledAdmissions: count,
    heldUnspentSlots: count,
    deviceBacklog: scannerDeviceBacklogSchema,
    scannerReconciliation: scannerReconciliationSchema,
    completeness: z.literal("not_established"),
    lastReceivedAt: utcInstantSchema.nullable(),
  }),
  contactRetention: eventContactRetentionSchema,
  evidence: z.object({
    clockVerification: z.literal("unverified"),
    providerVerification: z.literal("source_assertion"),
    presenceDuration: z.literal("not_established"),
    checkoutCaptureSupported: z.boolean(),
    entryCounting: z.literal("person_target_mode_browser_observations"),
  }),
});
export const attendanceAttemptQuerySchema = listQuerySchema(["observedAt", "receivedAt"] as const)
  .merge(attendanceScopeQuerySchema)
  .extend({
    userId: databaseIdSchema.optional(),
    action: z.string().min(1).max(40).optional(),
    reason: z.string().min(1).max(80).optional(),
  });
export const attendanceAttemptSchema = z.object({
  id: databaseIdSchema,
  userId: databaseIdSchema,
  displayName: z.string().nullable(),
  occurrenceId: databaseIdSchema.nullable(),
  operatorUserId: databaseIdSchema,
  deviceId: databaseIdSchema,
  action: z.string(),
  outcome: z.string(),
  reason: z.string(),
  exceptionReason: z.string().nullable(),
  admissionDecision: scannerAdmissionDecisionSchema.nullable(),
  observedAt: utcInstantSchema,
  receivedAt: utcInstantSchema,
  clockVerification: z.literal("unverified"),
  offlineReconciled: z.boolean(),
  captureContext: attendanceCaptureContextSchema,
});
export const attendanceAttemptsResponseSchema = paginatedResponseSchema("attempts", attendanceAttemptSchema);
export const attendanceReasonsQuerySchema = listQuerySchema(["count", "reason"] as const).merge(
  attendanceScopeQuerySchema,
);
export const attendanceReasonSchema = z.object({
  key: z.string(),
  action: z.string(),
  outcome: z.string(),
  reason: z.string(),
  exceptionReason: z.string().nullable(),
  count,
});
export const attendanceReasonsResponseSchema = paginatedResponseSchema("reasons", attendanceReasonSchema);
export const eventAttendancePeopleQuerySchema = listQuerySchema(["name", "firstObservedAt"] as const).merge(
  attendanceScopeQuerySchema,
);
export const eventAttendancePersonSchema = z.object({
  userId: databaseIdSchema,
  displayName: z.string().nullable(),
  firstObservedAt: utcInstantSchema,
  lastObservedAt: utcInstantSchema,
  observationCount: count,
  missingContextObservations: count,
  capturedTimeZones: count,
  physicalObservations: count,
  virtualObservations: count,
  importedObservations: count,
  providerAssertedVirtualObservations: count,
  reservedSessions: count,
  savedSessions: count,
  approvalPendingSessions: count,
});
export const eventAttendancePeopleResponseSchema = paginatedResponseSchema("attendees", eventAttendancePersonSchema);
