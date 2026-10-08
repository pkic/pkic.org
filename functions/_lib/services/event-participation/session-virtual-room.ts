import { sessionVirtualRoomResponseSchema } from "../../../../assets/shared/schemas/event-session-virtual-room";
import { instantToDateTimeLocal } from "../../../../assets/shared/timezone";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";

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
    SELECT json_extract(approved.payload_json,'$.virtualRoomUrl') AS url
    FROM event_agenda_state state
    JOIN event_agenda_published_occurrences approved ON approved.event_id=state.event_id AND approved.revision=state.published_revision
    JOIN events event ON event.id=state.event_id
    JOIN sessions session ON session.id=? AND session.user_id=? AND session.revoked_at IS NULL AND session.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    JOIN users person ON person.id=session.user_id AND person.active=1
    JOIN registrations registration ON registration.event_id=event.id AND registration.user_id=person.id AND registration.status='registered'
    LEFT JOIN agenda_session_participations participation ON participation.occurrence_id=approved.occurrence_id AND participation.user_id=person.id
    WHERE state.event_id=? AND approved.occurrence_id=? AND approved.revision=? AND event.timezone=?
    AND json_extract(approved.payload_json,'$.startAt')=?
    AND json_extract(approved.payload_json,'$.virtualRoomUrl') IS NOT NULL
    AND json_extract(approved.payload_json,'$.virtualRoomUrl') IS json_extract(event.settings_json,'$.agenda.sessionMedia.'||json_quote(approved.occurrence_id)||'.joinUrl')
    AND COALESCE((SELECT attendance.attendance_type FROM registration_day_attendance attendance JOIN event_days selected ON selected.id=attendance.event_day_id WHERE attendance.registration_id=registration.id AND selected.event_id=event.id AND selected.day_date=?),CASE WHEN EXISTS(SELECT 1 FROM event_days configured WHERE configured.event_id=event.id AND configured.day_date=?) THEN 'none' ELSE registration.attendance_type END) IN ('in_person','virtual')
    AND (COALESCE(json_extract(approved.payload_json,'$.admissionPolicy'),'preference')='preference' OR participation.status='reserved')
    AND (json_extract(approved.payload_json,'$.visibility')='public' OR participation.status='reserved' OR EXISTS(SELECT 1 FROM agenda_session_invitations invitation WHERE invitation.occurrence_id=approved.occurrence_id AND invitation.user_id=person.id AND invitation.revoked_at IS NULL))
    AND (COALESCE(json_extract(approved.payload_json,'$.accessPolicy'),'open')='open' OR EXISTS(SELECT 1 FROM agenda_session_invitations invitation WHERE invitation.occurrence_id=approved.occurrence_id AND invitation.user_id=person.id AND invitation.revoked_at IS NULL))`,
    [actor.sessionId, actor.userId, eventId, occurrenceId, basis.revision, basis.timezone, basis.start_at, day, day],
  );
  if (!destination) throw unavailable();
  return sessionVirtualRoomResponseSchema.parse(destination);
}
