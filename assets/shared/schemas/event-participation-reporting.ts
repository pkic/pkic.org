import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { utcInstantSchema } from "./api-common";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import { sessionParticipationRequestSchema, sessionParticipationStatusSchema } from "./event-participation-scanning";
export const attendanceQuerySchema = listQuerySchema(["title", "attendance"] as const).extend({
  occurrenceId: databaseIdSchema.optional(),
});
export const attendanceRowSchema = z.object({
  occurrenceId: databaseIdSchema,
  title: z.string(),
  scans: z.number().int(),
  unsuccessful: z.number().int(),
  attendees: z.number().int(),
});
export const attendanceReportSchema = paginatedResponseSchema("sessions", attendanceRowSchema);
export const attendancePeopleQuerySchema = listQuerySchema(["name", "firstObservedAt"] as const);
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
});
export const sessionBookingsResponseSchema = paginatedResponseSchema("participants", sessionBookingRowSchema);
export const leadCaptureRequestSchema = z
  .object({
    operatorUserId: databaseIdSchema,
    operationId: databaseIdSchema,
    deviceId: databaseIdSchema,
    consentConfirmed: z.literal(true),
    badgeId: databaseIdSchema,
    observedAt: utcInstantSchema,
  })
  .strict();
export const leadCaptureResponseSchema = z.object({
  captured: z.boolean(),
  recorded: z.boolean(),
  reason: z.enum(["captured", "consent_required", "unknown_credential", "revoked_badge", "missing_registration"]),
});
