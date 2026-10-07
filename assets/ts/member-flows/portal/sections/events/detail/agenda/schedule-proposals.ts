import { resolveAgendaDurationRules } from "../../../../../../../shared/event-agenda-duration";
import { stepAgendaSession, stepAgendaSessions } from "../../../../../../../shared/event-agenda-order";
import {
  agendaScheduleProposalSchema,
  AGENDA_SCHEDULE_BATCH_LIMIT,
} from "../../../../../../../shared/schemas/event-agenda-schedule";
import type { AgendaOccurrence, AgendaSnapshot } from "../../../../../../../shared/schemas/event-agenda";
import { agendaMovedAdditionalRoomIds } from "../../../../../../../shared/event-agenda-rooms";
export function scheduleMove(
  snapshot: AgendaSnapshot,
  session: AgendaOccurrence,
  startAt: string,
  roomId: string | null,
) {
  const duration =
    session.startAt && session.endAt
      ? Date.parse(session.endAt) - Date.parse(session.startAt)
      : resolveAgendaDurationRules(snapshot.durationRules).defaultMinutes * 60000;
  return agendaScheduleProposalSchema.parse({
    expectedRevision: snapshot.revision,
    changes: [
      {
        id: session.id,
        startAt,
        endAt: new Date(Date.parse(startAt) + duration).toISOString(),
        roomId,
        additionalRoomIds: agendaMovedAdditionalRoomIds(session, roomId),
      },
    ],
  });
}
export function scheduleSwap(snapshot: AgendaSnapshot, first: AgendaOccurrence, second: AgendaOccurrence) {
  return agendaScheduleProposalSchema.parse({
    expectedRevision: snapshot.revision,
    changes: [
      [first, second],
      [second, first],
    ].map(([session, target]) => ({
      id: session!.id,
      startAt: target!.startAt,
      endAt:
        session!.startAt && session!.endAt && target!.startAt
          ? new Date(
              Date.parse(target!.startAt) + Date.parse(session!.endAt) - Date.parse(session!.startAt),
            ).toISOString()
          : target!.endAt,
      roomId: target!.roomId,
      additionalRoomIds: target!.additionalRoomIds ?? [],
    })),
  });
}

/** Canonical movement includes displaced neighbors, which also count toward the atomic review limit. */
export function scheduleStep(
  snapshot: AgendaSnapshot,
  selected: ReadonlySet<string>,
  direction: -1 | 1,
  bounds?: { startAt: string; endAt: string },
) {
  const session = selected.size === 1 ? snapshot.occurrences.find((item) => selected.has(item.id)) : undefined;
  const changes = session
    ? stepAgendaSession(snapshot.occurrences, session, snapshot.timeZone, direction, bounds)
    : stepAgendaSessions(snapshot.occurrences, selected, snapshot.timeZone, direction);
  if (changes.length > AGENDA_SCHEDULE_BATCH_LIMIT)
    throw new Error(
      `This move affects ${changes.length} sessions, including neighboring sessions. One change can affect at most ${AGENDA_SCHEDULE_BATCH_LIMIT}. Select fewer sessions and try again.`,
    );
  return agendaScheduleProposalSchema.parse({ expectedRevision: snapshot.revision, changes });
}

/** Remove only placement times; retain the occurrence, content, credits and chosen locations. */
export function scheduleUnschedule(snapshot: AgendaSnapshot, session: AgendaOccurrence) {
  return agendaScheduleProposalSchema.parse({
    expectedRevision: snapshot.revision,
    changes: [
      {
        id: session.id,
        startAt: null,
        endAt: null,
        roomId: session.roomId,
        additionalRoomIds: session.additionalRoomIds ?? [],
      },
    ],
  });
}
