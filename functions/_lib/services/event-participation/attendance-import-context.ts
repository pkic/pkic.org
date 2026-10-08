import {
  attendanceImportContextSchema,
  attendanceImportRequestSchema,
} from "../../../../assets/shared/schemas/event-attendance-imports";
import { captureAttendanceContext } from "../../../../assets/shared/schemas/event-attendance-capture";
import { all, first } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import type { AuthorizationEvidence } from "../../db/authorization-guard";
import { AppError } from "../../errors";
import { publishedSessionsSql } from "./published-schedule";
import type { z } from "zod";
export type AttendanceImportContext = z.infer<typeof attendanceImportContextSchema>;
export async function captureImportContext(
  db: DatabaseLike,
  eventId: string,
  input: z.infer<typeof attendanceImportRequestSchema>,
): Promise<AttendanceImportContext> {
  const event = await first<{
    timeZone: string;
    eventTimeZone: string;
    publicationRevision: number | null;
    eventStartAt: string | null;
    eventEndAt: string | null;
  }>(
    db,
    `SELECT event.timezone AS eventTimeZone,state.published_revision AS publicationRevision,CASE WHEN state.published_revision IS NULL THEN event.timezone ELSE json_extract(publication.snapshot_json,'$.timeZone') END AS timeZone,event.starts_at AS eventStartAt,event.ends_at AS eventEndAt FROM events event LEFT JOIN event_agenda_state state ON state.event_id=event.id LEFT JOIN event_agenda_publications publication ON publication.event_id=event.id AND publication.revision=state.published_revision WHERE event.id=?`,
    [eventId],
  );
  if (!event) throw new AppError(404, "EVENT_NOT_FOUND", "Event unavailable.");
  const ids = Array.from(new Set(input.rows.flatMap((row) => (row.occurrenceId ? [row.occurrenceId] : []))));
  const occurrences = await all(
    db,
    `SELECT id AS occurrenceId,start_at AS startAt,end_at AS endAt FROM (${publishedSessionsSql}) WHERE event_id=? AND id IN (SELECT value FROM json_each(?)) ORDER BY id`,
    [eventId, JSON.stringify(ids)],
  );
  try {
    if (occurrences.length !== ids.length) throw new Error("Missing published session");
    return attendanceImportContextSchema.parse({
      ...event,
      occurrences,
      capturedDays: Array.from(
        new Set(
          input.rows.map(
            (row) =>
              captureAttendanceContext(row.observedAt, {
                timeZone: event.timeZone,
                publicationRevision: event.publicationRevision,
                source: "import_review",
              }).dayDate,
          ),
        ),
      ).sort(),
    });
  } catch {
    throw new AppError(
      422,
      "ATTENDANCE_IMPORT_EVIDENCE_INVALID",
      "Resolve unpublished sessions or invalid event timezone/intervals before reviewing.",
    );
  }
}
/** Exact current-context fence: superseded overlapping intervals still require a new review. */
export function importContextEvidence(eventId: string, context: AttendanceImportContext): AuthorizationEvidence {
  return {
    sql: `SELECT 1 FROM events event LEFT JOIN event_agenda_state state ON state.event_id=event.id LEFT JOIN event_agenda_publications publication ON publication.event_id=event.id AND publication.revision=state.published_revision WHERE event.id=? AND event.timezone=? AND event.starts_at IS ? AND event.ends_at IS ? AND state.published_revision IS ? AND (state.published_revision IS NULL OR json_extract(publication.snapshot_json,'$.timeZone')=?) AND NOT EXISTS(SELECT 1 FROM json_each(?) frozen LEFT JOIN (${publishedSessionsSql}) session ON session.event_id=event.id AND session.id=json_extract(frozen.value,'$.occurrenceId') WHERE session.id IS NULL OR session.start_at IS NOT json_extract(frozen.value,'$.startAt') OR session.end_at IS NOT json_extract(frozen.value,'$.endAt'))`,
    bindings: [
      eventId,
      context.eventTimeZone,
      context.eventStartAt,
      context.eventEndAt,
      context.publicationRevision,
      context.timeZone,
      JSON.stringify(context.occurrences),
    ],
  };
}
/** Original row times are validated against reviewed intervals, never silently against a new schedule. */
export function importRowsEvidence(
  eventId: string,
  rows: z.infer<typeof attendanceImportRequestSchema>["rows"],
  context: AttendanceImportContext,
  notAfter: string,
): AuthorizationEvidence {
  return {
    sql: `SELECT 1 WHERE EXISTS(SELECT 1 FROM events WHERE id=?) AND NOT EXISTS(SELECT 1 FROM json_each(?) row LEFT JOIN users person ON person.id=json_extract(row.value,'$.userId') LEFT JOIN json_each(?) session ON json_extract(session.value,'$.occurrenceId')=json_extract(row.value,'$.occurrenceId') WHERE person.id IS NULL OR json_extract(row.value,'$.observedAt')>? OR (json_extract(row.value,'$.occurrenceId') IS NOT NULL AND (session.value IS NULL OR json_extract(row.value,'$.observedAt')<json_extract(session.value,'$.startAt') OR json_extract(row.value,'$.observedAt')>=json_extract(session.value,'$.endAt'))) OR (json_extract(row.value,'$.occurrenceId') IS NULL AND ((? IS NOT NULL AND json_extract(row.value,'$.observedAt')<?) OR (? IS NOT NULL AND json_extract(row.value,'$.observedAt')>=?))))`,
    bindings: [
      eventId,
      JSON.stringify(rows),
      JSON.stringify(context.occurrences),
      notAfter,
      context.eventStartAt,
      context.eventStartAt,
      context.eventEndAt,
      context.eventEndAt,
    ],
  };
}
