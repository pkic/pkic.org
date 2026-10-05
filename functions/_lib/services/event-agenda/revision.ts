import { prepareAuthorizationGuard, isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { prepareScopedAuditLog } from "../audit";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike } from "../../types";
import { nowIso } from "../../utils/time";
import { isAgendaScheduleGuardFailure, prepareAgendaScheduleGuard } from "./schedule-guards";
import {
  agendaScheduleConflictDetailsSchema,
  type AgendaScheduleConflictProposal,
} from "../../../../assets/shared/schemas/event-agenda-schedule";

export async function commitAgendaRevision(
  db: DatabaseLike,
  eventId: string,
  revision: number,
  statements: StatementLike[],
  actorUserId: string | null = null,
  conflictProposal?: AgendaScheduleConflictProposal,
) {
  try {
    await db.batch([
      db
        .prepare(
          "INSERT INTO event_agenda_state(event_id,revision,updated_at) VALUES (?,0,?) ON CONFLICT(event_id) DO NOTHING",
        )
        .bind(eventId, nowIso()),
      prepareAuthorizationGuard(db, {
        sql: "SELECT 1 FROM event_agenda_state WHERE event_id = ? AND revision = ?",
        bindings: [eventId, revision],
      }),
      ...statements,
      ...prepareAgendaScheduleGuard(db, eventId),
      prepareScopedAuditLog(
        db,
        { type: "event", id: eventId },
        actorUserId ? "user" : "system",
        actorUserId,
        "agenda.revision.updated",
        "event_agenda",
        eventId,
        { fromRevision: revision, toRevision: revision + 1 },
      ),
      db
        .prepare("UPDATE event_agenda_state SET revision=revision+1,updated_at=? WHERE event_id=? AND revision=?")
        .bind(nowIso(), eventId, revision),
    ]);
  } catch (error) {
    if (isAgendaScheduleGuardFailure(error))
      throw new AppError(
        409,
        "AGENDA_SCHEDULE_CONFLICT",
        "A scheduled person is unavailable at this time",
        agendaScheduleConflictDetailsSchema.parse({
          conflicts: ["A speaker or assigned staff member has another session or duty, or needs travel time."],
          proposal: conflictProposal,
        }),
      );
    if (isAuthorizationGuardFailure(error))
      throw new AppError(
        409,
        "AGENDA_REVISION_CHANGED",
        "Another organizer changed the agenda. Refresh before trying again.",
      );
    throw error;
  }
}
