import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { normalizedEmailSchema, utcInstantSchema } from "./api-common";
export const sessionInvitationCalendarContextSchema = z.object({
  title: z.string(),
  startAt: utcInstantSchema,
  endAt: utcInstantSchema,
  timeZone: z.string(),
  roomId: databaseIdSchema.nullable(),
  additionalRoomIds: z.array(databaseIdSchema),
  admissionPolicy: z.string(),
  accessPolicy: z.string(),
  visibility: z.string(),
  bookingOpensAt: utcInstantSchema.nullable(),
  bookingClosesAt: utcInstantSchema.nullable(),
});
export const sessionRsvpReplySchema = z.object({
  invitationId: databaseIdSchema,
  attendeeEmail: normalizedEmailSchema,
  responseStatus: z.enum(["accepted", "declined", "tentative", "bounced"]),
  provider: z.string().min(2).max(80),
  sourceMessageId: z.string().min(1).max(500),
  icsUid: z.string().max(500),
  invitationSequence: z.number().int().nonnegative().optional(),
  claimedReplyAt: utcInstantSchema.optional(),
});
export const sessionRsvpOutcomeSchema = z.object({
  disposition: z.enum(["applied", "tentative", "needs_review", "duplicate", "rejected"]),
  participationStatus: z.string().nullable(),
  chronology: z.literal("server_received_order_client_clock_unverified"),
});
export type SessionInvitationCalendarContext = z.infer<typeof sessionInvitationCalendarContextSchema>;
