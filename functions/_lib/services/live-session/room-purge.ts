import { eventLiveChatSettings, liveChatKeptUntil } from "../../../../assets/shared/live-chat-retention";
import { liveRoomWindow } from "../../../../assets/shared/live-session-policy";
import type { LiveRoomSession } from "../../../../assets/shared/schemas/live-session-room";
import { first } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { parseJsonSafe } from "../../utils/json";

/**
 * What a room keeps after its week when its event keeps the chat longer: the
 * attendee chat with how moderation left it, the chat counts, and what the
 * room needs to know its session and its copy. Operator chat, questions,
 * polls, ballots and controls go with the week as before.
 */
const LIVE_CHAT_KEPT_TABLES = [
  "room_session",
  "copy_state",
  "room_chat",
  "room_chat_hidden",
  "room_chat_restrictions",
  "room_chat_totals",
  "room_chat_senders",
] as const;

/** How often a room keeping its chat checks the event's setting again, so a shorter choice applies within a day. */
const LIVE_CHAT_RECHECK_MS = 24 * 60 * 60 * 1000;

/** When the room erases its attendee chat under the event's current setting, as epoch milliseconds. */
async function readLiveChatKeptUntil(db: DatabaseLike, eventId: string, endAt: string): Promise<number> {
  const row = await first<{ settings_json: string | null }>(db, "SELECT settings_json FROM events WHERE id=?", [
    eventId,
  ]);
  const settings = parseJsonSafe<Record<string, unknown>>(row?.settings_json ?? null, {});
  return liveChatKeptUntil(endAt, eventLiveChatSettings(settings).keepDays);
}

/**
 * A room's session is a week over: everyone still connected is let go, and
 * the room erases its storage. When its event keeps the chat longer and there
 * is chat to keep, only the attendee chat and its counts stay, and the room
 * checks the event's setting again daily until the chat's own time is up.
 * Answers whether the room erased everything.
 */
export async function purgeLiveRoom(
  ctx: Pick<DurableObjectState, "getWebSockets" | "storage">,
  db: DatabaseLike,
  session: { eventId: string; session: LiveRoomSession } | null,
  sql: { emptyExcept(kept: readonly string[]): void; erased(): void },
  chat: { holdsMessages(): boolean },
): Promise<boolean> {
  for (const socket of ctx.getWebSockets()) {
    try {
      socket.close(1001, "This session's room has closed");
    } catch {
      // Already closed.
    }
  }
  const keepUntil =
    session && chat.holdsMessages() ? await readLiveChatKeptUntil(db, session.eventId, session.session.endAt) : 0;
  if (Date.now() < keepUntil) {
    sql.emptyExcept(LIVE_CHAT_KEPT_TABLES);
    await ctx.storage.setAlarm(Math.min(keepUntil, Date.now() + LIVE_CHAT_RECHECK_MS));
    return false;
  }
  await ctx.storage.deleteAll();
  sql.erased();
  return true;
}

/** Whether a room's chat may be erased: never while its session's room is still open. */
export function liveChatErasable(session: { session: LiveRoomSession } | null): boolean {
  return !session || Date.now() >= liveRoomWindow(session.session.startAt, session.session.endAt).closesAt;
}
