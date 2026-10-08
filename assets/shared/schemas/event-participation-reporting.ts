import { badgeCredentialSchema } from "./badge-credential";
import { z } from "zod";
import { attendanceCaptureRequestFieldsSchema, refineAttendanceCaptureIntent } from "./event-attendance-capture";
import { databaseIdSchema } from "./identifiers";
import { utcInstantSchema } from "./api-common";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import { sessionParticipationRequestSchema, sessionParticipationStatusSchema } from "./event-participation-scanning";
export const attendanceQuerySchema = listQuerySchema(["title", "attendance"] as const).extend({
  occurrenceId: databaseIdSchema.optional(),
  attendanceMode: z.enum(["physical", "virtual"]).optional(),
});
export const attendanceRowSchema = z.object({
  occurrenceId: databaseIdSchema,
  title: z.string(),
  scans: z.number().int(),
  unsuccessful: z.number().int(),
  attendees: z.number().int(),
  physicalAttendees: z.number().int().optional(),
  virtualAttendees: z.number().int().optional(),
});
export const attendanceReportSchema = paginatedResponseSchema("sessions", attendanceRowSchema);
export const attendancePeopleQuerySchema = listQuerySchema(["name", "firstObservedAt"] as const).extend({
  attendanceMode: z.enum(["physical", "virtual"]).optional(),
});
export const attendancePersonSchema = z.object({
  userId: databaseIdSchema,
  displayName: z.string().nullable(),
  observationCount: z.number().int().nonnegative(),
  firstObservedAt: utcInstantSchema,
  lastObservedAt: utcInstantSchema,
});
export const attendancePeopleResponseSchema = paginatedResponseSchema("attendees", attendancePersonSchema);
export const sessionBookingsQuerySchema = listQuerySchema(["name", "createdAt"] as const).extend({
  status: sessionParticipationStatusSchema.optional(),
});
export const sessionBookingRowSchema = z.object({
  id: databaseIdSchema,
  userId: databaseIdSchema,
  displayName: z.string().nullable(),
  attendanceMode: sessionParticipationRequestSchema.shape.attendanceMode,
  status: sessionParticipationStatusSchema,
  createdAt: utcInstantSchema,
  calendarReplyDisposition: z.enum(["applied", "tentative", "needs_review", "rejected"]).nullable().optional(),
  calendarReplyReceivedAt: utcInstantSchema.nullable().optional(),
  calendarReplyResponse: z.enum(["accepted", "declined", "tentative", "bounced"]).nullable().optional(),
});
export const sessionBookingsResponseSchema = paginatedResponseSchema("participants", sessionBookingRowSchema);
export const leadCaptureRequestSchema = z
  .object({
    ...attendanceCaptureRequestFieldsSchema.shape,
    operatorUserId: databaseIdSchema,
    operationId: databaseIdSchema,
    deviceId: databaseIdSchema,
    consentConfirmed: z.literal(true),
    badgeId: badgeCredentialSchema,
    observedAt: utcInstantSchema,
  })
  .strict()
  .superRefine(refineAttendanceCaptureIntent);
export const leadCaptureResponseSchema = z.object({
  captured: z.boolean(),
  recorded: z.boolean(),
  reason: z.enum([
    "captured",
    "verification_required",
    "consent_required",
    "unknown_credential",
    "revoked_badge",
    "expired_badge",
    "missing_registration",
    "contact_retention_expired",
  ]),
});
