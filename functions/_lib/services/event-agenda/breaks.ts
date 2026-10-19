import { prepareAgendaOccurrenceSettings } from "./occurrence-settings";
import type { z } from "zod";
import { agendaBreaksCreateSchema } from "../../../../assets/shared/schemas/event-agenda-breaks";
import { agendaOccurrenceCreateSchema } from "../../../../assets/shared/schemas/event-agenda";
import { agendaScheduleConflictProposalSchema } from "../../../../assets/shared/schemas/event-agenda-schedule";
import { instantToDateTimeLocal } from "../../../../assets/shared/timezone";
import { all } from "../../db/queries";
import { prepareAuthorizationGuard } from "../../db/authorization-guard";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { operationalIntervalDays } from "./operational-days";
import { agendaAdditionalRoomStatements } from "./occurrence-rooms";
import { prepareAgendaOccurrenceInsert } from "./occurrence-insert";
import { validateAgendaSchedule } from "./mutations";
import { commitAgendaRevision } from "./revision";
import { getAgenda } from "./read";

/** Selected venue days form one manual authoring command, never a recurrence or imported source. */
export async function createAgendaBreaks(
  db: DatabaseLike,
  eventId: string,
  eventSlug: string,
  input: z.infer<typeof agendaBreaksCreateSchema>,
  actorUserId: string,
) {
  const snapshot = await getAgenda(db, eventId, eventSlug);
  const configured = await all<{ day_date: string; starts_at: string | null; ends_at: string | null }>(
    db,
    "SELECT day_date,starts_at,ends_at FROM event_days WHERE event_id=? ORDER BY day_date LIMIT 367",
    [eventId],
  );
  if (configured.length > 366)
    throw new AppError(422, "AGENDA_BREAK_DAY_LIMIT", "Choose an event with at most 366 days.");
  const allowedDates = new Set(
    configured.length
      ? configured.map((day) => day.day_date)
      : snapshot.eventStartsAt && snapshot.eventEndsAt
        ? operationalIntervalDays(snapshot.eventStartsAt, snapshot.eventEndsAt, snapshot.timeZone)
        : [],
  );
  const dates = input.intervals.map((interval) =>
    instantToDateTimeLocal(interval.startAt, snapshot.timeZone).slice(0, 10),
  );
  if (new Set(dates).size !== dates.length || dates.some((date) => !allowedDates.has(date)))
    throw new AppError(422, "AGENDA_BREAK_DAYS_INVALID", "Choose each configured event day once.");
  input.intervals.forEach((interval, index) => {
    const day = configured.find((candidate) => candidate.day_date === dates[index]);
    const endDate = instantToDateTimeLocal(
      new Date(Date.parse(interval.endAt) - 1).toISOString(),
      snapshot.timeZone,
    ).slice(0, 10);
    if (
      endDate !== dates[index] ||
      (day?.starts_at && interval.startAt < day.starts_at) ||
      (day?.ends_at && interval.endAt > day.ends_at)
    )
      throw new AppError(422, "AGENDA_BREAK_DAY_WINDOW", "Keep each break within its event day's time window.");
  });
  const roomIds = input.roomIds ?? [];
  if (roomIds.some((id) => !snapshot.rooms.some((room) => room.id === id)))
    throw new AppError(422, "AGENDA_BREAK_ROOM_INVALID", "Choose locations belonging to this event.");
  const candidates = input.intervals.map((interval) => ({
    ...agendaOccurrenceCreateSchema.parse({
      ...interval,
      title: input.title,
      expectedRevision: input.expectedRevision,
      roomId: roomIds[0] ?? null,
      additionalRoomIds: roomIds.slice(1),
      kind: "break",
      sponsorIds: input.sponsorIds,
    }),
    id: crypto.randomUUID(),
    speakers: [],
  }));
  const proposal = agendaScheduleConflictProposalSchema.parse({ timeZone: snapshot.timeZone, occurrences: candidates });
  validateAgendaSchedule(snapshot, [...snapshot.occurrences, ...candidates], proposal);
  const dayJson = JSON.stringify(configured);
  await commitAgendaRevision(
    db,
    eventId,
    input.expectedRevision,
    [
      prepareAuthorizationGuard(db, {
        sql: `SELECT 1 FROM events WHERE id=? AND timezone=? AND starts_at IS ? AND ends_at IS ?
        AND (SELECT json_group_array(json_object('day_date',day_date,'starts_at',starts_at,'ends_at',ends_at)) FROM
          (SELECT day_date,starts_at,ends_at FROM event_days WHERE event_id=? ORDER BY day_date))=?
        AND NOT EXISTS(SELECT 1 FROM json_each(?) chosen WHERE NOT EXISTS(
          SELECT 1 FROM event_agenda_rooms room WHERE room.id=chosen.value AND room.event_id=?))`,
        bindings: [
          eventId,
          snapshot.timeZone,
          snapshot.eventStartsAt,
          snapshot.eventEndsAt,
          eventId,
          dayJson,
          JSON.stringify(roomIds),
          eventId,
        ],
      }),
      ...candidates.flatMap((candidate) => [
        prepareAgendaOccurrenceInsert(db, eventId, candidate.id, candidate),
        ...agendaAdditionalRoomStatements(db, candidate.id, candidate.additionalRoomIds ?? []),
      ]),
      ...(await prepareAgendaOccurrenceSettings(db, eventId, candidates)),
    ],
    actorUserId,
    proposal,
  );
  return getAgenda(db, eventId, eventSlug);
}
