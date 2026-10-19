import { prepareMeetingAgendaDurationGuard, rethrowMeetingAgendaDurationFailure } from "./agenda-duration";
import { prepareMeetingAgendaIntervals } from "./agenda-intervals";
import { prepareScopedAuditLog } from "../audit";
import { prepareAgendaScheduleGuard, isAgendaScheduleGuardFailure } from "../event-agenda/schedule-guards";
import { z } from "zod";
import {
  meetingAgendaSchema,
  meetingAgendaItemsSchema,
  meetingAgendaSaveSchema,
  type MeetingAgenda,
} from "../../../../assets/shared/schemas/meeting-agenda";
import type { AuthAdmin, DatabaseLike, StatementLike } from "../../types";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { getManagedGroupEventSeries } from "./series";
import { commitEventResourceManagementBatch } from "./management";
interface Saved {
  revision: number;
  format_version: number;
  name: string;
  items_json: string;
  exception: number;
  published_at: string | null;
}
export async function getMeetingAgenda(
  db: DatabaseLike,
  actor: AuthAdmin,
  group: string,
  seriesId: string,
  occurrenceId: string | null,
): Promise<MeetingAgenda> {
  const { series } = await getManagedGroupEventSeries(db, actor, group, seriesId);
  const state = await first<{ format_version: number; write_revision: number }>(
    db,
    "SELECT format_version,write_revision FROM event_meeting_agenda_state WHERE series_id=?",
    [seriesId],
  );
  const version = state?.format_version ?? 0;
  const occurrence = occurrenceId
    ? await first<{ starts_at: string; ends_at: string }>(
        db,
        "SELECT starts_at,ends_at FROM event_occurrences WHERE id=? AND series_id=?",
        [occurrenceId, seriesId],
      )
    : null;
  if (occurrenceId && !occurrence)
    throw new AppError(404, "MEETING_OCCURRENCE_NOT_FOUND", "Meeting occurrence not found.");
  const saved = occurrenceId
    ? await first<Saved>(
        db,
        "SELECT revision,format_version,name,items_json,exception,published_at FROM event_meeting_occurrence_agendas WHERE occurrence_id=? AND series_id=?",
        [occurrenceId, seriesId],
      )
    : null;
  const format =
    (!occurrence || occurrence.starts_at > nowIso()) && version
      ? await first<{ name: string; items_json: string }>(
          db,
          "SELECT name,items_json FROM event_meeting_agenda_formats WHERE series_id=? AND version=?",
          [seriesId, version],
        )
      : null;
  return meetingAgendaSchema.parse({
    seriesId,
    occurrenceId,
    revision: saved?.revision ?? 0,
    formatVersion: version,
    sourceFormatVersion: saved?.format_version ?? version,
    writeRevision: state?.write_revision ?? 0,
    name: saved?.name ?? format?.name ?? "Meeting agenda",
    items: meetingAgendaItemsSchema.parse(JSON.parse(saved?.items_json ?? format?.items_json ?? "[]")),
    startsAt: occurrence?.starts_at ?? null,
    endsAt: occurrence?.ends_at ?? null,
    timezone: series.timezone,
    exception: saved?.exception === 1,
    publishedAt: saved?.published_at ?? null,
  });
}
export async function saveMeetingAgenda(
  db: DatabaseLike,
  actor: AuthAdmin,
  group: string,
  seriesId: string,
  input: z.infer<typeof meetingAgendaSaveSchema>,
): Promise<MeetingAgenda> {
  const { series, context } = await getManagedGroupEventSeries(db, actor, group, seriesId);
  const now = nowIso();
  const target = input.fromOccurrenceId
    ? await first<{ starts_at: string; ends_at: string; status: string }>(
        db,
        "SELECT starts_at,ends_at,status FROM event_occurrences WHERE id=? AND series_id=?",
        [input.fromOccurrenceId, seriesId],
      )
    : null;
  if (input.scope !== "template" && !target)
    throw new AppError(422, "MEETING_AGENDA_TARGET_REQUIRED", "Choose the meeting occurrence to update.");
  if (target && (target.starts_at <= now || target.status !== "scheduled"))
    throw new AppError(409, "MEETING_AGENDA_PAST_IMMUTABLE", "Past and cancelled agendas are preserved.");
  const minutes = input.items.reduce((total, item) => total + item.durationMinutes, 0);
  if (
    minutes > series.durationMinutes ||
    (target && minutes > (Date.parse(target.ends_at) - Date.parse(target.starts_at)) / 60000)
  )
    throw new AppError(422, "MEETING_AGENDA_DURATION_EXCEEDED", "Agenda items exceed the meeting duration.");
  const serialized = JSON.stringify(input.items),
    guardId = uuid();
  const statements: StatementLike[] = [
    db
      .prepare(
        "INSERT INTO event_meeting_agenda_write_guards(id,series_id,occurrence_id,expected_revision,expected_format_version,expected_write_revision,created_at) VALUES(?,?,?,?,?,?,?)",
      )
      .bind(
        guardId,
        seriesId,
        input.scope === "template" ? null : input.fromOccurrenceId,
        input.expectedRevision,
        input.expectedFormatVersion,
        input.expectedWriteRevision,
        now,
      ),
  ];
  if (input.scope === "template") {
    statements.push(
      db
        .prepare(
          "INSERT INTO event_meeting_agenda_formats(series_id,version,name,items_json,created_by,created_at) VALUES(?,?,?,?,?,?)",
        )
        .bind(seriesId, input.expectedFormatVersion + 1, input.name, serialized, actor.id, now),
    );
    statements.push(
      db
        .prepare(
          "INSERT INTO event_meeting_agenda_state(series_id,format_version,updated_at) VALUES(?,?,?) ON CONFLICT(series_id) DO UPDATE SET format_version=excluded.format_version,updated_at=excluded.updated_at",
        )
        .bind(seriesId, input.expectedFormatVersion + 1, now),
    );
  } else if (input.scope === "occurrence") {
    statements.push(
      db
        .prepare(
          "INSERT INTO event_meeting_occurrence_agendas(occurrence_id,series_id,revision,format_version,name,items_json,exception,created_by,updated_at) SELECT id,series_id,?, ?,?,?,1,?,? FROM event_occurrences WHERE id=? AND series_id=? AND starts_at>? AND status='scheduled' ON CONFLICT(occurrence_id) DO UPDATE SET revision=excluded.revision,name=excluded.name,items_json=excluded.items_json,exception=1,updated_at=excluded.updated_at WHERE event_meeting_occurrence_agendas.published_at IS NULL",
        )
        .bind(
          input.expectedRevision + 1,
          input.expectedFormatVersion,
          input.name,
          serialized,
          actor.id,
          now,
          input.fromOccurrenceId,
          seriesId,
          now,
        ),
    );
  } else {
    statements.push(
      db
        .prepare(
          "INSERT INTO event_meeting_occurrence_agendas(occurrence_id,series_id,revision,format_version,name,items_json,exception,created_by,updated_at) SELECT occurrence.id,occurrence.series_id,1,?,?,?,?,?,? FROM event_occurrences occurrence WHERE occurrence.series_id=? AND occurrence.starts_at>=? AND occurrence.starts_at>? AND occurrence.status='scheduled' AND NOT EXISTS(SELECT 1 FROM event_meeting_occurrence_agendas existing WHERE existing.occurrence_id=occurrence.id AND (existing.exception=1 OR existing.published_at IS NOT NULL)) ON CONFLICT(occurrence_id) DO UPDATE SET revision=event_meeting_occurrence_agendas.revision+1,name=excluded.name,items_json=excluded.items_json,format_version=excluded.format_version,updated_at=excluded.updated_at WHERE event_meeting_occurrence_agendas.exception=0 AND event_meeting_occurrence_agendas.published_at IS NULL",
        )
        .bind(input.expectedFormatVersion, input.name, serialized, 0, actor.id, now, seriesId, target!.starts_at, now),
    );
  }
  if (input.scope === "template") {
    statements.push(
      db
        .prepare(
          "INSERT INTO event_meeting_occurrence_agendas(occurrence_id,series_id,revision,format_version,name,items_json,exception,created_by,updated_at) SELECT id,series_id,1,?,?,?,0,?,? FROM event_occurrences WHERE series_id=? AND starts_at>? AND status='scheduled' ON CONFLICT(occurrence_id) DO NOTHING",
        )
        .bind(input.expectedFormatVersion + 1, input.name, serialized, actor.id, now, seriesId, now),
    );
  }
  {
    statements.push(
      ...prepareMeetingAgendaDurationGuard(db, seriesId, { agendaUpdatedAt: now }),
      ...prepareMeetingAgendaIntervals(db, series.eventId, seriesId, now),
      ...prepareAgendaScheduleGuard(db, series.eventId),
    );
  }
  statements.push(
    db
      .prepare(
        "INSERT INTO event_meeting_agenda_state(series_id,format_version,write_revision,updated_at) VALUES(?,?,?,?) ON CONFLICT(series_id) DO UPDATE SET write_revision=excluded.write_revision,updated_at=excluded.updated_at",
      )
      .bind(
        seriesId,
        input.scope === "template" ? input.expectedFormatVersion + 1 : input.expectedFormatVersion,
        input.expectedWriteRevision + 1,
        now,
      ),
  );
  statements.push(
    prepareScopedAuditLog(
      db,
      { type: "group", id: context.groupId },
      "admin",
      actor.id,
      "meeting_agenda_saved",
      "event_series",
      seriesId,
      {
        scope: input.scope,
        occurrenceId: input.fromOccurrenceId,
        formatVersion: input.expectedFormatVersion,
        itemIds: input.items.map((item) => item.id),
      },
      now,
    ),
  );
  statements.push(db.prepare("DELETE FROM event_meeting_agenda_write_guards WHERE id=?").bind(guardId));
  try {
    await commitEventResourceManagementBatch(db, actor, context, "manage", statements);
  } catch (error) {
    rethrowMeetingAgendaDurationFailure(error);
    if (isAgendaScheduleGuardFailure(error))
      throw new AppError(409, "AGENDA_SCHEDULE_CONFLICT", "A speaker has another scheduled commitment at this time.");
    if (error instanceof Error && error.message.includes("MEETING_AGENDA_IMMUTABLE"))
      throw new AppError(409, "MEETING_AGENDA_IMMUTABLE", "Past or approved agendas are preserved.");
    if (error instanceof Error && error.message.includes("MEETING_AGENDA_REVISION_CHANGED"))
      throw new AppError(409, "MEETING_AGENDA_REVISION_CHANGED", "The agenda changed. Refresh before saving.");
    throw error;
  }
  return getMeetingAgenda(db, actor, group, seriesId, input.scope === "template" ? null : input.fromOccurrenceId);
}
export async function publishMeetingAgenda(
  db: DatabaseLike,
  actor: AuthAdmin,
  group: string,
  seriesId: string,
  occurrenceId: string,
  expectedRevision: number,
) {
  const { context } = await getManagedGroupEventSeries(db, actor, group, seriesId);
  const agenda = await getMeetingAgenda(db, actor, group, seriesId, occurrenceId);
  if (agenda.items.length === 0)
    throw new AppError(422, "MEETING_AGENDA_EMPTY", "Add agenda items before publication.");
  const now = nowIso(),
    guard = uuid();
  const items = JSON.stringify(agenda.items);
  try {
    await commitEventResourceManagementBatch(db, actor, context, "manage", [
      db
        .prepare(
          "INSERT INTO event_meeting_agenda_write_guards(id,series_id,occurrence_id,expected_revision,expected_format_version,expected_write_revision,created_at) VALUES(?,?,?,?,?,?,?)",
        )
        .bind(guard, seriesId, occurrenceId, expectedRevision, agenda.formatVersion, agenda.writeRevision, now),
      db
        .prepare(
          "INSERT INTO event_meeting_occurrence_agendas(occurrence_id,series_id,revision,format_version,name,items_json,exception,published_at,created_by,updated_at) VALUES(?,?,?,?,?,?,0,?,?,?) ON CONFLICT(occurrence_id) DO UPDATE SET revision=event_meeting_occurrence_agendas.revision+1,published_at=excluded.published_at,updated_at=excluded.updated_at",
        )
        .bind(
          occurrenceId,
          seriesId,
          expectedRevision + 1,
          agenda.formatVersion,
          agenda.name,
          items,
          now,
          actor.id,
          now,
        ),
      ...prepareMeetingAgendaDurationGuard(db, seriesId, { occurrenceIds: [occurrenceId] }),
      ...prepareMeetingAgendaIntervals(db, context.eventId, seriesId, now),
      ...prepareAgendaScheduleGuard(db, context.eventId),
      db
        .prepare(
          "INSERT INTO event_meeting_agenda_state(series_id,format_version,write_revision,updated_at) VALUES(?,?,?,?) ON CONFLICT(series_id) DO UPDATE SET write_revision=excluded.write_revision,updated_at=excluded.updated_at",
        )
        .bind(seriesId, agenda.formatVersion, agenda.writeRevision + 1, now),
      prepareScopedAuditLog(
        db,
        { type: "group", id: context.groupId },
        "admin",
        actor.id,
        "meeting_agenda_published",
        "event_occurrence",
        occurrenceId,
        { revision: expectedRevision + 1, formatVersion: agenda.formatVersion },
        now,
      ),
      db.prepare("DELETE FROM event_meeting_agenda_write_guards WHERE id=?").bind(guard),
    ]);
  } catch (error) {
    rethrowMeetingAgendaDurationFailure(error);
    if (error instanceof Error && error.message.includes("MEETING_AGENDA_"))
      throw new AppError(
        409,
        "MEETING_AGENDA_CHANGED",
        "This agenda is published, past, or changed. Refresh to review it.",
      );
    throw error;
  }
  return getMeetingAgenda(db, actor, group, seriesId, occurrenceId);
}
