import { sessionVirtualRoomResponseSchema } from "../../../../assets/shared/schemas/event-session-virtual-room";
import { batchFirst } from "../../db/pagination";
import { AppError } from "../../errors";
import type { DatabaseLike, D1StatementResult, Env } from "../../types";
import { publishedSessionsSql } from "./published-schedule";
import {
  registrationSessionDayOptionsSql,
  registrationSessionAttendance,
  sessionAccessEligibleSql,
} from "./session-access";
import { approvedVirtualRoomUrlSql, draftVirtualRoomUrlSql } from "../event-agenda/virtual-room-links";
import { eventReadIdSql, type EventReadSelection } from "../events/selection";
import { readParticipantEvent } from "./participant-read-context";

/** An attendee link is a private read, never an allocation or admission grant. */
export function prepareSessionVirtualRoom(
  db: DatabaseLike,
  eventSelection: EventReadSelection,
  occurrenceId: string,
  actor: { userId: string; sessionId: string },
) {
  const selected = eventReadIdSql(eventSelection);
  const unavailable = () =>
    new AppError(
      403,
      "SESSION_VIRTUAL_ROOM_UNAVAILABLE",
      "A confirmed event registration and access to this session are required for its virtual room.",
    );
  const statement = db
    .prepare(
      `
    SELECT ${approvedVirtualRoomUrlSql("approved")} AS url,1 AS registered,registration.attendance_type AS registration_default_mode,
      ${registrationSessionDayOptionsSql("registration", "access_session")} AS registration_days_json,
      access_session.start_at AS startAt,event.timezone AS timeZone
    FROM event_agenda_state state
    JOIN event_agenda_published_occurrences approved ON approved.event_id=state.event_id AND approved.revision=state.published_revision
    JOIN events event ON event.id=state.event_id
    JOIN sessions session ON session.id=? AND session.user_id=? AND session.revoked_at IS NULL AND session.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    JOIN users person ON person.id=session.user_id AND person.active=1
    JOIN registrations registration ON registration.event_id=event.id AND registration.user_id=person.id AND registration.status='registered'
    JOIN (${publishedSessionsSql}) access_session ON access_session.id=approved.occurrence_id AND access_session.event_id=event.id AND access_session.published_revision=approved.revision
    WHERE state.event_id=${selected.sql} AND approved.occurrence_id=? AND access_session.start_at IS NOT NULL
    AND ${approvedVirtualRoomUrlSql("approved")} IS NOT NULL
    AND ${approvedVirtualRoomUrlSql("approved")} IS ${draftVirtualRoomUrlSql("approved.occurrence_id", "event.settings_json")}
    AND ${sessionAccessEligibleSql("access_session", "person.id", null)}`,
    )
    .bind(actor.sessionId, actor.userId, ...selected.bindings, occurrenceId);
  return {
    statements: [statement],
    decode(loaded: D1StatementResult[]) {
      const destination = batchFirst<Parameters<typeof registrationSessionAttendance>[0] & { url: string }>(loaded[0]);
      if (!destination || !["in_person", "virtual"].includes(registrationSessionAttendance(destination) ?? ""))
        throw unavailable();
      return sessionVirtualRoomResponseSchema.parse({ url: destination.url });
    },
  };
}

export function readSessionVirtualRoomRequest(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "INTERNAL_SIGNING_SECRET">,
  slug: string,
  occurrenceId: string,
) {
  return readParticipantEvent(db, request, env, slug, "existing", (userId, event, sessionId) =>
    prepareSessionVirtualRoom(db, event, occurrenceId, { userId, sessionId }),
  );
}
