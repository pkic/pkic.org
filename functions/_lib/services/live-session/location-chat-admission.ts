import { z } from "zod";
import { databaseIdSchema } from "../../../../assets/shared/schemas/identifiers";
import { liveLocationChatDayAt } from "../../../../assets/shared/live-location-chat";
import { liveLocationChatScopeSchema } from "../../../../assets/shared/schemas/live-location-chat";
import { AppError } from "../../errors";
import type { DatabaseLike, Env } from "../../types";
import { getEventBySlug } from "../events";
import {
  prepareLiveLocationChatRead,
  type LiveLocationChatRecord,
  type LiveLocationChatRow,
} from "./location-chat-read";
import { liveRoomParticipantSchema, type LiveRoomParticipant } from "./room-admission";
import { offeredOverlayToken, signedInLiveParticipant } from "./room-access";

/** What the Worker tells a location's chat about a socket it admitted, through the room binding only. */
export const LIVE_LOCATION_CHAT_ADMISSION_HEADER = "x-pkic-live-location-chat-admission";

export const liveLocationChatAdmissionSchema = z
  .object({
    eventId: z.string().min(1).max(200),
    scope: liveLocationChatScopeSchema,
    participant: liveRoomParticipantSchema.extend({ locationOccurrenceIds: z.array(databaseIdSchema).optional() }),
    readBookmark: z.string().min(1).max(1024).optional(),
  })
  .strict();
export type LiveLocationChatAdmission = z.infer<typeof liveLocationChatAdmissionSchema>;

/**
 * Admits one socket to a location's chat for the day it joins at `now`: the one open now, else the next, else
 * the last. Operators join as operators; others as a speaker credited on, or an attendee with access to, any
 * of that day's sessions there. A browser source has no chat to join.
 */
export async function admitLiveLocationChatParticipant(
  db: DatabaseLike,
  env: Pick<Env, "INTERNAL_SIGNING_SECRET">,
  request: Request,
  params: { eventSlug: string; roomId: string },
  now = Date.now(),
): Promise<{ record: LiveLocationChatRecord; participant: LiveRoomParticipant }> {
  if (offeredOverlayToken(request) !== null)
    throw new AppError(403, "LIVE_LOCATION_CHAT_SOURCE", "A browser source cannot join a location's chat.");
  const event = await getEventBySlug(db, params.eventSlug);
  const read = prepareLiveLocationChatRead(db, event.id, params.roomId);
  const rows = (await read.statement.all<LiveLocationChatRow>()).results ?? [];
  const record = read.decode(rows, (days) => liveLocationChatDayAt(days, now));
  const participant = await signedInLiveParticipant(db, request, env, {
    eventId: event.id,
    occurrenceIds: record.sessions.map((session) => session.occurrenceId),
    speakersByOccurrence: record.speakersByOccurrence,
  });
  return { record, participant };
}

/** The scope a chat stores and sends, from the record its admission read. */
export function liveLocationChatScope(record: LiveLocationChatRecord) {
  return liveLocationChatScopeSchema.parse({
    eventName: record.eventName,
    roomId: record.roomId,
    day: record.day,
    timeZone: record.timeZone,
    sessions: record.sessions.map(({ occurrenceId, title, startAt, endAt }) => ({
      occurrenceId,
      title,
      startAt,
      endAt,
    })),
  });
}
