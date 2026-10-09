import { sessionVirtualRoomResponseSchema } from "../../../../assets/shared/schemas/event-session-virtual-room";
import { instantToDateTimeLocal } from "../../../../assets/shared/timezone";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { publishedSessionsSql } from "./published-schedule";
import { registrationDayAttendanceSql, sessionAccessEligibleSql } from "./session-access";
import { approvedVirtualRoomUrlSql, draftVirtualRoomUrlSql } from "../event-agenda/virtual-room-links";

/** An attendee link is a private read, never an allocation or admission grant. */
export async function readSessionVirtualRoom(
  db: DatabaseLike,
  eventId: string,
  occurrenceId: string,
  actor: { userId: string; sessionId: string },
) {
  const unavailable = () =>
    new AppError(
      403,
      "SESSION_VIRTUAL_ROOM_UNAVAILABLE",
      "A confirmed event registration and access to this session are required for its virtual room.",
    );
  const basis = await first<{ revision: number; start_at: string | null; timezone: string }>(
    db,
    "SELECT approved.revision,json_extract(approved.payload_json,'$.startAt') AS start_at,event.timezone FROM event_agenda_state state JOIN event_agenda_published_occurrences approved ON approved.event_id=state.event_id AND approved.revision=state.published_revision JOIN events event ON event.id=state.event_id WHERE state.event_id=? AND approved.occurrence_id=?",
    [eventId, occurrenceId],
  );
  if (!basis?.start_at) throw unavailable();
  const day = instantToDateTimeLocal(basis.start_at, basis.timezone).slice(0, 10);
  const destination = await first<{ url: string }>(
    db,
    `
    SELECT ${approvedVirtualRoomUrlSql("approved")} AS url
    FROM event_agenda_state state
    JOIN event_agenda_published_occurrences approved ON approved.event_id=state.event_id AND approved.revision=state.published_revision
    JOIN events event ON event.id=state.event_id
    JOIN sessions session ON session.id=? AND session.user_id=? AND session.revoked_at IS NULL AND session.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    JOIN users person ON person.id=session.user_id AND person.active=1
    JOIN registrations registration ON registration.event_id=event.id AND registration.user_id=person.id AND registration.status='registered'
    WHERE state.event_id=? AND approved.occurrence_id=? AND approved.revision=? AND event.timezone=?
    AND json_extract(approved.payload_json,'$.startAt')=?
    AND ${approvedVirtualRoomUrlSql("approved")} IS NOT NULL
    AND ${approvedVirtualRoomUrlSql("approved")} IS ${draftVirtualRoomUrlSql("approved.occurrence_id", "event.settings_json")}
    AND ${registrationDayAttendanceSql("registration", "?")} IN ('in_person','virtual')
    AND EXISTS(SELECT 1 FROM (${publishedSessionsSql}) access_session WHERE access_session.id=approved.occurrence_id AND access_session.event_id=event.id AND access_session.published_revision=approved.revision AND ${sessionAccessEligibleSql("access_session", "person.id", null, "NULL")})`,
    [actor.sessionId, actor.userId, eventId, occurrenceId, basis.revision, basis.timezone, basis.start_at, day, day],
  );
  if (!destination) throw unavailable();
  return sessionVirtualRoomResponseSchema.parse(destination);
}
