import { prepareScopedAuditLog } from "../audit";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike } from "../../types";
import { nowIso } from "../../utils/time";
import { uuid } from "../../utils/ids";
import { agendaRevisionSchema } from "../../../../assets/shared/schemas/event-agenda";
import { isAgendaScheduleGuardFailure, prepareAgendaScheduleGuard } from "./schedule-guards";
import {
  agendaScheduleConflictDetailsSchema,
  type AgendaScheduleConflictProposal,
} from "../../../../assets/shared/schemas/event-agenda-schedule";

/** A stale revision is a structural conflict, independent of the current permission guard. */
export function prepareAgendaRevisionGuard(db: DatabaseLike, eventId: string, revision: number): StatementLike {
  const expectedRevision = agendaRevisionSchema.shape.expectedRevision.parse(revision);
  return db
    .prepare("INSERT INTO event_agenda_revision_guards(id,event_id,expected_revision) VALUES(?,?,?)")
    .bind(uuid(), eventId, expectedRevision);
}

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
      prepareAgendaRevisionGuard(db, eventId, revision),
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
    if (error instanceof Error && error.message.includes("AGENDA_REVISION_CHANGED"))
      throw new AppError(
        409,
        "AGENDA_REVISION_CHANGED",
        "Another organizer changed the agenda. Refresh before trying again.",
      );
    throw error;
  }
}
