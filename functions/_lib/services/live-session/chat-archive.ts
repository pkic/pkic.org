import {
  LIVE_CHAT_ARCHIVE_MAX_BYTES,
  LIVE_CHAT_ARCHIVE_MAX_SESSIONS,
  type LiveChatEraseResponse,
} from "../../../../assets/shared/schemas/event-live-chat-archive";
import { boundedCsvWriter } from "../../csv";
import { all } from "../../db/queries";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike, Env } from "../../types";
import { nowIso } from "../../utils/time";
import { prepareScopedAuditLog } from "../audit";
import type { LiveChatArchiveRow } from "./room-chat";
import { liveRoomName } from "./room-admission";

interface ChatSession {
  id: string;
  title: string;
  start_at: string | null;
}

const STATUS_LABELS: Record<LiveChatArchiveRow["status"], string> = {
  shown: "Shown",
  hidden: "Removed by a moderator",
  held: "Held after reports",
};

/**
 * The sessions whose rooms received attendee chat, from the copied chat
 * counts, in agenda order. An event with more than one request handles is
 * refused whole, so neither a download nor an erase silently skips a session.
 */
async function chatSessions(db: DatabaseLike, eventId: string) {
  const sessions = await all<ChatSession>(
    db,
    `SELECT o.id,o.title,o.start_at FROM event_session_chat_totals c
     JOIN event_agenda_occurrences o ON o.id=c.occurrence_id AND o.event_id=c.event_id
     WHERE c.event_id=? AND c.messages>0 ORDER BY o.start_at,o.title,o.id LIMIT ?`,
    [eventId, LIVE_CHAT_ARCHIVE_MAX_SESSIONS + 1],
  );
  if (sessions.length > LIVE_CHAT_ARCHIVE_MAX_SESSIONS)
    throw new AppError(
      413,
      "LIVE_CHAT_TOO_MANY_SESSIONS",
      `The chat covers more than ${LIVE_CHAT_ARCHIVE_MAX_SESSIONS} sessions, more than one request handles.`,
    );
  return sessions;
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
 * Every attendee message the event's live rooms still hold, one CSV row each,
 * by session and time in UTC. Rooms keep their chat a week after the session
 * unless the event keeps it longer, so a download is empty once that passed.
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
  csv.push(["Session", "Session start (UTC)", "Sent (UTC)", "Author", "Message", "Status"]);
  for (const session of await chatSessions(db, eventId)) {
    for (const message of await namespace.getByName(liveRoomName(eventId, session.id)).chatArchive())
      csv.push([
        session.title,
        session.start_at ?? "",
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
 * Erases the chat of every session whose room has closed. A room still open
 * keeps its chat, so a running session never loses its conversation; the
 * chat counts in the popularity report stay either way. The request is
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
  const sessions = await chatSessions(db, eventId);
  await audit(db, actor, eventId, "live_session.chat.erase_requested", { sessions: sessions.length });
  const result = { erasedSessions: 0, openSessions: 0 };
  for (const session of sessions) {
    if (await namespace.getByName(liveRoomName(eventId, session.id)).eraseChat()) result.erasedSessions += 1;
    else result.openSessions += 1;
  }
  await audit(db, actor, eventId, "live_session.chat.erased", result);
  return result;
}
