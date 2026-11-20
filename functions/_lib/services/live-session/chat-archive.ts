import {
  LIVE_CHAT_ARCHIVE_MAX_BYTES,
  LIVE_CHAT_ARCHIVE_MAX_CHATS,
  type LiveChatEraseResponse,
} from "../../../../assets/shared/schemas/event-live-chat-archive";
import { instantToCalendarDate } from "../../../../assets/shared/timezone";
import { boundedCsvWriter } from "../../csv";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike, Env } from "../../types";
import { nowIso } from "../../utils/time";
import { prepareScopedAuditLog } from "../audit";
import type { LiveChatArchiveRow } from "./room-chat";
import { readPublishedLiveAgenda } from "./approved-agenda";
import { liveLocationChatName } from "./room-admission";

interface LocationChat {
  roomId: string;
  roomName: string;
  day: string;
}

const STATUS_LABELS: Record<LiveChatArchiveRow["status"], string> = {
  shown: "Shown",
  hidden: "Hidden by a moderator",
  held: "Held after reports",
};

/** What the download names a message sent between sessions. */
const BETWEEN_SESSIONS = "Between sessions";

/**
 * Every chat the event's rooms may hold, one per room and event day of the approved agenda, by day and room,
 * with the titles of the sessions messages are dated by. An event with more than one request handles is
 * refused whole, so neither a download nor an erase silently skips a chat.
 */
async function locationChats(db: DatabaseLike, eventId: string) {
  const agenda = await readPublishedLiveAgenda(db, eventId);
  if (!agenda) return { chats: [] as LocationChat[], titles: new Map<string, string>() };
  const rooms = new Map(agenda.rooms.map((room) => [room.id, room.name]));
  const chats = new Map<string, LocationChat>();
  for (const session of agenda.occurrences) {
    if (session.kind === "break" || session.placeholder || !session.startAt) continue;
    const day = instantToCalendarDate(session.startAt, agenda.timeZone);
    for (const roomId of [session.roomId, ...(session.additionalRoomIds ?? [])]) {
      if (roomId && rooms.has(roomId)) chats.set(`${day}:${roomId}`, { roomId, roomName: rooms.get(roomId)!, day });
    }
  }
  if (chats.size > LIVE_CHAT_ARCHIVE_MAX_CHATS)
    throw new AppError(
      413,
      "LIVE_CHAT_TOO_MANY_CHATS",
      `The event has more than ${LIVE_CHAT_ARCHIVE_MAX_CHATS} chats, more than one request handles.`,
    );
  return {
    chats: [...chats.values()].sort((a, b) => a.day.localeCompare(b.day) || a.roomName.localeCompare(b.roomName)),
    titles: new Map(agenda.occurrences.map((session) => [session.id, session.title])),
  };
}

function rooms(env: Pick<Env, "LIVE_SESSION_ROOMS">) {
  if (!env.LIVE_SESSION_ROOMS) throw new AppError(503, "LIVE_ROOMS_UNAVAILABLE", "Live rooms are not available.");
  return env.LIVE_SESSION_ROOMS;
}

async function audit(
  db: DatabaseLike,
  actor: AuthAdmin,
  eventId: string,
  action: string,
  details: Record<string, number>,
) {
  await db.batch([
    prepareScopedAuditLog(
      db,
      { type: "event", id: eventId },
      "user",
      actor.id,
      action,
      "event",
      eventId,
      details,
      nowIso(),
    ),
  ]);
}

/**
 * Every attendee message the event's rooms still hold, one CSV row each, by
 * day, room and time in UTC, with the session it was sent during. A room keeps
 * its day's chat a week after its last session unless the event keeps it
 * longer, so a download is empty once that passed.
 */
export async function exportEventChat(
  db: DatabaseLike,
  env: Pick<Env, "LIVE_SESSION_ROOMS">,
  actor: AuthAdmin,
  eventId: string,
): Promise<string> {
  const namespace = rooms(env);
  // Refuses the row that would outgrow the download, so a huge event never fills the Worker's memory first.
  const csv = boundedCsvWriter(LIVE_CHAT_ARCHIVE_MAX_BYTES);
  csv.push(["Room", "Day", "Session", "Sent (UTC)", "Author", "Message", "Status"]);
  const { chats, titles } = await locationChats(db, eventId);
  for (const chat of chats) {
    for (const message of await namespace.getByName(liveLocationChatName(eventId, chat.roomId, chat.day)).chatArchive())
      csv.push([
        chat.roomName,
        chat.day,
        (message.occurrence_id && titles.get(message.occurrence_id)) || BETWEEN_SESSIONS,
        message.sent_at,
        message.author_name,
        message.body,
        STATUS_LABELS[message.status],
      ]);
  }
  await audit(db, actor, eventId, "live_session.chat.exported", { messages: csv.rows });
  return csv.toString();
}

/**
 * Erases every room's chat whose day is over. A chat still open keeps its
 * messages, so a running day never loses its conversation; the chat counts in
 * the popularity report stay either way. The request is
 * recorded before any room erases, so a failure part way leaves evidence of
 * what was asked; erasing again finishes the rest, since an erased room has
 * nothing left to remove.
 */
export async function eraseEventChat(
  db: DatabaseLike,
  env: Pick<Env, "LIVE_SESSION_ROOMS">,
  actor: AuthAdmin,
  eventId: string,
): Promise<LiveChatEraseResponse> {
  const namespace = rooms(env);
  const { chats } = await locationChats(db, eventId);
  await audit(db, actor, eventId, "live_session.chat.erase_requested", { chats: chats.length });
  const result = { erasedChats: 0, openChats: 0 };
  for (const chat of chats) {
    if (await namespace.getByName(liveLocationChatName(eventId, chat.roomId, chat.day)).eraseChat())
      result.erasedChats += 1;
    else result.openChats += 1;
  }
  await audit(db, actor, eventId, "live_session.chat.erased", result);
  return result;
}
