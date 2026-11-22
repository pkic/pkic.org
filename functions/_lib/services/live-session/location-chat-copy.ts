import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { prepareScopedAuditLog } from "../audit";
import type { LiveLocationChatPendingCopy } from "./location-chat-store";

/**
 * One atomic copy of a location chat's counts and moderation acts: each session's message and sender counts
 * (never message text) as the session reports read them, and an audit row per act, on the location.
 */
export async function copyLiveLocationChatToD1(db: DatabaseLike, copy: LiveLocationChatPendingCopy): Promise<void> {
  const copiedAt = nowIso();
  const statements = [
    ...copy.totals.map((total) =>
      db
        .prepare(
          `INSERT INTO event_session_chat_totals(event_id,occurrence_id,messages,people,copied_at) VALUES(?,?,?,?,?)
           ON CONFLICT(event_id,occurrence_id) DO UPDATE SET messages=excluded.messages,people=excluded.people,copied_at=excluded.copied_at`,
        )
        .bind(copy.eventId, total.occurrence_id, total.messages, total.people, copiedAt),
    ),
    ...copy.staffActions.map((action) =>
      prepareScopedAuditLog(
        db,
        { type: "event", id: copy.eventId },
        "user",
        action.actor_user_id,
        action.action,
        "event_agenda_room",
        copy.roomId,
        JSON.parse(action.details_json) as Record<string, unknown>,
        action.occurred_at,
        `live-location-chat:${copy.eventId}:${copy.roomId}:${copy.day}:${action.seq}`,
      ),
    ),
  ];
  if (statements.length) await db.batch(statements);
}
