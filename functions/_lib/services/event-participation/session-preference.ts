/** Saving a session changes interest only; registration and live authority guard the atomic command. */
import {
  sessionParticipationResponseSchema,
  type sessionParticipationCommandSchema,
} from "../../../../assets/shared/schemas/event-participation-scanning";
import type { z } from "zod";
import { batchFirst } from "../../db/pagination";
import { AppError } from "../../errors";
import type { DatabaseLike, D1StatementResult } from "../../types";
import { nowIso } from "../../utils/time";
import { prepareAuditLogAfterOneChange, isAuditChangeGuardFailure } from "../audit";
import { buildEventAudiencePredicate } from "../events/visibility";
import { eventReadIdSql, type EventReadSelection } from "../events/selection";
import { preparePersonalCalendarEntries } from "./calendar-entries";
import { privateSessionAccessSql, heldParticipationStatusesSql } from "./personal-agenda-membership";
import { publishedSessionsSql } from "./published-schedule";
import { prepareParticipationWork } from "./reconciliation";

export function prepareSessionPreference(
  db: DatabaseLike,
  selection: EventReadSelection,
  occurrenceId: string,
  userId: string,
  action: "save" | "unsave",
  options: Pick<z.infer<typeof sessionParticipationCommandSchema>, "attendanceMode" | "replaceOccurrenceId"> = {},
) {
  if (options.replaceOccurrenceId)
    throw new AppError(
      409,
      "SESSION_SWITCH_INVALID",
      "Choose a different confirmed reservation and a session you can reserve immediately.",
    );
  const event = eventReadIdSql(selection);
  const audience = buildEventAudiencePredicate("event", { userId });
  const at = nowIso();
  const saved = action === "save" ? 1 : 0;
  return {
    statements: [
      db
        .prepare(`INSERT INTO agenda_session_participations(id,event_id,occurrence_id,user_id,attendance_mode,status,created_at,updated_at,saved)
        SELECT ?,s.event_id,s.id,?,COALESCE(?,p.attendance_mode,(SELECT CASE registration.attendance_type WHEN 'virtual' THEN 'remote' ELSE 'physical' END FROM registrations registration WHERE registration.event_id=s.event_id AND registration.user_id=? AND registration.status='registered'),'physical'),'saved',?,?,?
        FROM (${publishedSessionsSql}) s JOIN events event ON event.id=s.event_id
        LEFT JOIN agenda_session_participations p ON p.occurrence_id=s.id AND p.user_id=?
        WHERE s.id=? AND event.id=${event.sql} AND ${audience.sql}
          AND (s.visibility='public' OR ${privateSessionAccessSql})
          AND (?=0 OR EXISTS(SELECT 1 FROM registrations registration WHERE registration.event_id=s.event_id AND registration.user_id=? AND registration.status='registered'))
        ON CONFLICT(occurrence_id,user_id) DO UPDATE SET saved=excluded.saved,updated_at=excluded.updated_at,
          attendance_mode=CASE WHEN agenda_session_participations.status IN (${heldParticipationStatusesSql}) THEN agenda_session_participations.attendance_mode ELSE excluded.attendance_mode END`)
        .bind(
          crypto.randomUUID(),
          userId,
          options.attendanceMode ?? null,
          userId,
          at,
          at,
          saved,
          userId,
          occurrenceId,
          ...event.bindings,
          ...audience.bindings,
          userId,
          saved,
          userId,
        ),
      prepareAuditLogAfterOneChange(
        db,
        "user",
        userId,
        "session_preference_changed",
        "agenda_occurrence",
        occurrenceId,
        { saved: Boolean(saved) },
        at,
      ),
      ...preparePersonalCalendarEntries(db, selection, userId),
      prepareParticipationWork(db, selection),
      db
        .prepare(
          "SELECT status,attendance_mode AS attendanceMode FROM agenda_session_participations WHERE occurrence_id=? AND user_id=?",
        )
        .bind(occurrenceId, userId),
    ],
    decode(results: D1StatementResult[]) {
      return sessionParticipationResponseSchema.parse(batchFirst(results[results.length - 1]));
    },
  };
}
export function refuseSessionPreference(error: unknown): never {
  if (isAuditChangeGuardFailure(error))
    throw new AppError(
      403,
      "EVENT_REGISTRATION_REQUIRED",
      "Register for this event before adding sessions to your agenda. The session must also be available to you.",
    );
  throw error;
}
