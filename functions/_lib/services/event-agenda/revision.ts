import { eventReadIdSql, type EventReadSelection } from "../events/selection";
import { prepareEventSpeakingStanding } from "../member-standing/event-speaking";
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
export function prepareAgendaRevisionGuard(
  db: DatabaseLike,
  eventId: EventReadSelection,
  revision: number,
): StatementLike {
  const expectedRevision = agendaRevisionSchema.shape.expectedRevision.parse(revision);
  const event = eventReadIdSql(eventId);
  return db
    .prepare(`INSERT INTO event_agenda_revision_guards(id,event_id,expected_revision) SELECT ?,${event.sql},?`)
    .bind(uuid(), ...event.bindings, expectedRevision);
}

/** Canonical revision transition, composed with request authorization and the response read. */
export function prepareAgendaRevisionCommit(
  db: DatabaseLike,
  eventId: EventReadSelection,
  revision: number,
  statements: StatementLike[],
  audit: StatementLike,
  responseStatements: StatementLike[] = [],
) {
  const event = eventReadIdSql(eventId);
  return [
    db
      .prepare(
        `INSERT INTO event_agenda_state(event_id,revision,updated_at) SELECT ${event.sql},0,? ON CONFLICT(event_id) DO NOTHING`,
      )
      .bind(...event.bindings, nowIso()),
    prepareAgendaRevisionGuard(db, eventId, revision),
    ...statements,
    ...prepareEventSpeakingStanding(db, nowIso(), { eventId, nextAgendaRevision: true }),
    ...prepareAgendaScheduleGuard(db, eventId),
    audit,
    db
      .prepare(
        `UPDATE event_agenda_state SET revision=revision+1,updated_at=? WHERE event_id=${event.sql} AND revision=?`,
      )
      .bind(nowIso(), ...event.bindings, revision),
    ...responseStatements,
  ];
}

export async function commitAgendaRevision(
  db: DatabaseLike,
  eventId: string,
  revision: number,
  statements: StatementLike[],
  actorUserId: string | null = null,
  conflictProposal?: AgendaScheduleConflictProposal,
  responseStatements: StatementLike[] = [],
) {
  try {
    const results = await db.batch(
      prepareAgendaRevisionCommit(
        db,
        eventId,
        revision,
        statements,
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
        responseStatements,
      ),
    );
    return responseStatements.length ? results.slice(-responseStatements.length) : [];
  } catch (error) {
    throwAgendaRevisionError(error, conflictProposal);
  }
}

export function throwAgendaRevisionError(error: unknown, conflictProposal?: AgendaScheduleConflictProposal): never {
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
