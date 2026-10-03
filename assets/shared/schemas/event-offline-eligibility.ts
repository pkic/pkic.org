import { z } from "zod";
import { sessionParticipationStatusSchema } from "./event-participation-scanning";

export const offlineEligibilityQuerySchema = z
  .object({
    occurrenceId: z.string().uuid().optional(),
    afterBadgeId: z.string().uuid().optional(),
    publishedRevision: z.coerce.number().int().nonnegative().optional(),
  })
  .strict();
export const offlineEligibilityResponseSchema = z
  .object({
    eventId: z.string().uuid(),
    operatorUserId: z.string().uuid(),
    occurrenceId: z.string().uuid().nullable(),
    revision: z.number().int().nonnegative(),
    publishedRevision: z.number().int().nonnegative().nullable(),
    serverNow: z.string().datetime(),
    expiresAt: z.string().datetime(),
    session: z
      .object({
        admissionPolicy: z.enum(["preference", "reservation", "approval"]),
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
            eventRegistered: z.boolean(),
            physicalDayEligible: z.boolean(),
            sessionStatus: sessionParticipationStatusSchema.nullable(),
            sessionEligible: z.boolean(),
            privateAccess: z.boolean(),
          })
          .strict(),
      )
      .max(250),
    nextBadgeId: z.string().uuid().nullable(),
  })
  .strict();
export type OfflineEligibilityQuery = z.infer<typeof offlineEligibilityQuerySchema>;
