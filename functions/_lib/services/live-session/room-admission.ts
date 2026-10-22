import { z } from "zod";
import type { UserSessionTokenClaims } from "../../auth/user-session-token";
import { databaseIdSchema } from "../../../../assets/shared/schemas/identifiers";
import {
  liveOverlayViewSchema,
  liveRoomRoleSchema,
  liveRoomSessionSchema,
} from "../../../../assets/shared/schemas/live-session-room";

/**
 * What the Worker tells a room about a socket it has already admitted. The
 * room is reachable only through its binding, so it trusts this header and
 * never re-reads D1 on the connection path.
 */
export const LIVE_ROOM_ADMISSION_HEADER = "x-pkic-live-room-admission";

export const liveRoomParticipantSchema = z
  .object({
    role: liveRoomRoleSchema,
    userId: databaseIdSchema.nullable(),
    name: z.string().min(1).max(200).nullable(),
    /** An operator who also manages the event: the chat policy's organizer. */
    organizer: z.boolean().optional(),
    /** The person's profile photo, which a question they ask by name may show. */
    photoUrl: z.string().min(1).max(500).nullable().optional(),
    /** The identity the person acts as now, whose title and organization label what they write. */
    actingIdentityId: databaseIdSchema.nullable().optional(),
    /** Verified nonsecret claims, accepted only from the Worker through its private binding. */
    sessionClaims: z.custom<UserSessionTokenClaims>().optional(),
    overlayRoomId: databaseIdSchema.optional(),
    overlayExpiresAt: z.number().int().positive().optional(),
    /** The output a read-only source draws; only the stage display receives what Preview lines up next. */
    overlayOutput: liveOverlayViewSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.role === "overlay" && (!value.overlayRoomId || value.overlayExpiresAt === undefined))
      context.addIssue({
        code: "custom",
        message: "Read-only sources require admitted physical-room access and expiry.",
      });
    if (value.role !== "overlay" && value.overlayOutput !== undefined)
      context.addIssue({ code: "custom", message: "Only read-only sources draw an output." });
  });
export type LiveRoomParticipant = z.infer<typeof liveRoomParticipantSchema> & {
  /** Server-owned subscription, persisted with this socket through hibernation. Never accepted in admission input. */
  questionThreadId?: string;
  /** Latest server-received watch request, so a slower authorization cannot restore an older thread. */
  questionThreadRequestId?: string;
};

export const liveRoomAdmissionSchema = z
  .object({
    eventId: z.string().min(1).max(200),
    session: liveRoomSessionSchema,
    participant: liveRoomParticipantSchema,
    readBookmark: z.string().min(1).max(1024).optional(),
  })
  .strict();
export type LiveRoomAdmissionMessage = z.infer<typeof liveRoomAdmissionSchema>;

/** One room per agenda occurrence of one event. */
export function liveRoomName(eventId: string, occurrenceId: string): string {
  return `${eventId}:${occurrenceId}`;
}

/** Preserve only server-owned thread metadata when fresh canonical admission replaces an attachment. */
export function preserveLiveRoomThread(
  participant: LiveRoomParticipant,
  attachment: LiveRoomParticipant,
): LiveRoomParticipant {
  return {
    ...participant,
    questionThreadId: attachment.questionThreadId,
    questionThreadRequestId: attachment.questionThreadRequestId,
  };
}
