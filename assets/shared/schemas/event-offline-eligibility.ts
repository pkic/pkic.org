import { utcInstantSchema } from "./api-common";
import { z } from "zod";
import { sessionParticipationStatusSchema } from "./event-participation-scanning";
import { databaseIdSchema } from "./identifiers";
import { nativeEventCaptureContextSchema } from "./event-attendance-capture";
import { agendaAdmissionPolicySchema } from "./event-agenda";

export const offlineEligibilityQuerySchema = z
  .object({
    occurrenceId: z.string().uuid().optional(),
    roomId: z.string().uuid().optional(),
    afterBadgeId: z.string().uuid().optional(),
    publishedRevision: z.coerce.number().int().nonnegative().optional(),
  })
  .strict();
export const offlineEligibilityResponseSchema = z
  .object({
    eventId: z.string().uuid(),
    operatorUserId: z.string().uuid(),
    occurrenceId: z.string().uuid().nullable(),
    roomId: z.string().uuid().nullable().optional(),
    revision: z.number().int().nonnegative(),
    publishedRevision: z.number().int().nonnegative().nullable(),
    nativeEventContext: nativeEventCaptureContextSchema.optional(),
    serverNow: z.string().datetime(),
    expiresAt: z.string().datetime(),
    session: z
      .object({
        admissionPolicy: agendaAdmissionPolicySchema,
        visibility: z.enum(["public", "private"]),
      })
      .strict()
      .nullable(),
    entries: z
      .array(
        z
          .object({
            badgeId: z.string().uuid(),
            userId: z.string().uuid(),
            credentialHash: z.string().regex(/^[a-f0-9]{64}$/),
            revoked: z.boolean(),
            expiresAt: utcInstantSchema.nullable().optional(),
            eventRegistered: z.boolean(),
            physicalDayEligible: z.boolean(),
            sessionStatus: sessionParticipationStatusSchema.nullable(),
            sessionEligible: z.boolean(),
            allocationCompatible: z.boolean().optional(),
            privateAccess: z.boolean(),
          })
          .strict(),
      )
      .max(250),
    nextBadgeId: z.string().uuid().nullable(),
  })
  .strict();
export type OfflineEligibilityQuery = z.infer<typeof offlineEligibilityQuerySchema>;
export const enrolledOfflineEligibilityQuerySchema = offlineEligibilityQuerySchema.extend({
  epochId: databaseIdSchema,
  deviceId: databaseIdSchema,
});
export const enrolledOfflineEligibilityResponseSchema = offlineEligibilityResponseSchema.extend({
  epochId: databaseIdSchema,
  deviceId: databaseIdSchema,
});
