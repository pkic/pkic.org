import { instantToCalendarDate } from "../../../../assets/shared/timezone";
import type { LiveRoomSession } from "../../../../assets/shared/schemas/live-session-room";
import type { LiveAuthorStamp } from "../../../../assets/shared/schemas/live-session-author";
import type { Env } from "../../types";
import { liveLocationChatName } from "./room-admission";

/** One attendee message as a broadcast may show it: plain words after its author's name. */
export interface LiveChatOnAirMessage {
  id: string;
  authorName: string;
  text: string;
}

/** Which messages a broadcast asks for: those sent by `sentBy`, each cut to `cutAt` characters. */
export interface LiveChatOnAirOptions {
  sentBy?: string | null;
  cutAt?: number | null;
}

/** The chat a session's broadcast shows: the latest attendee messages of its location's chat. */
export interface LiveOnAirChat {
  messages(limit: number, options?: LiveChatOnAirOptions): Promise<LiveChatOnAirMessage[]>;
  /** When the first message after `since` was sent, so a delayed feed knows when to fill again. */
  firstSentAfter(since: string): Promise<string | null>;
}

/** A chat message an operator asks as a question, as its author wrote it in the location's chat. */
export interface LiveChatQuestion {
  authorUserId: string;
  authorName: string;
  body: string;
  askedAt: string;
  authorPhotoUrl: string | null;
  stamp: LiveAuthorStamp | null;
}

/** How long the studio waits for the location's chat; the desk applies its controls one at a time. */
const ON_AIR_CHAT_WAIT_MS = 2_000;

/** The chat's answer, or `fallback` when it fails or takes longer than the desk can wait. */
async function answered<Value>(read: Promise<Value> | undefined, fallback: Value): Promise<Value> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("The location's chat did not answer in time")), ON_AIR_CHAT_WAIT_MS);
    });
    return (await Promise.race([read ?? Promise.resolve(fallback), late])) ?? fallback;
  } catch (error) {
    console.error("Live location chat on air read failed", error);
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A session room's on-air chat, read from its location's chat for the session's day. A session without a
 * location shows no chat; a chat that cannot answer in time shows none this time, and the next refill asks again.
 */
export function liveLocationOnAirChat(
  env: Pick<Env, "LIVE_SESSION_ROOMS">,
  room: () => { eventId: string; session: LiveRoomSession } | null,
): LiveOnAirChat {
  const chat = () => {
    const current = room();
    if (!current?.session.roomId || !env.LIVE_SESSION_ROOMS) return null;
    const { eventId, session } = current;
    const day = instantToCalendarDate(session.startAt, session.timeZone);
    return env.LIVE_SESSION_ROOMS.getByName(liveLocationChatName(eventId, session.roomId!, day));
  };
  return {
    messages: (limit, options = {}) => answered<LiveChatOnAirMessage[]>(chat()?.locationChatOnAir(limit, options), []),
    firstSentAfter: (since) => answered<string | null>(chat()?.locationChatFirstSentAfter(since), null),
  };
}
