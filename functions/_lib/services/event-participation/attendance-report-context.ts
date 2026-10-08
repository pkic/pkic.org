import {
  storedAttendanceCaptureContext,
  attendanceCaptureSourceSchema,
} from "../../../../assets/shared/schemas/event-attendance-capture";
import { first } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { AppError } from "../../errors";
import { zonedDateTimeToDate } from "../../../../assets/shared/timezone";
import type { z } from "zod";
import type { attendanceScopeQuerySchema } from "../../../../assets/shared/schemas/event-attendance-reporting";
export async function attendanceReportContext(
  db: DatabaseLike,
  eventId: string,
  query: z.infer<typeof attendanceScopeQuerySchema>,
) {
  const event = await first<{ timeZone: string }>(
    db,
    `SELECT COALESCE(json_extract(publication.snapshot_json,'$.timeZone'),events.timezone,'UTC') AS timeZone FROM events LEFT JOIN event_agenda_state state ON state.event_id=events.id LEFT JOIN event_agenda_publications publication ON publication.event_id=events.id AND publication.revision=state.published_revision WHERE events.id=?`,
    [eventId],
  );
  if (!event) throw new AppError(404, "EVENT_NOT_FOUND", "Event unavailable.");
  if (
    query.occurrenceId &&
    !(await first(db, "SELECT 1 FROM event_agenda_occurrences WHERE event_id=? AND id=?", [
      eventId,
      query.occurrenceId,
    ]))
  )
    throw new AppError(404, "ATTENDANCE_OCCURRENCE_NOT_FOUND", "Session unavailable for this event.");
  let intentStartAt: string | null = null,
    intentEndAt: string | null = null;
  if (query.dayDate) {
    const [year, month, day] = query.dayDate.split("-").map(Number);
    try {
      intentStartAt = zonedDateTimeToDate(
        { year, month, day, hour: 0, minute: 0, second: 0 },
        event.timeZone,
      ).toISOString();
      const next = new Date(Date.UTC(year, month - 1, day + 1));
      intentEndAt = zonedDateTimeToDate(
        {
          year: next.getUTCFullYear(),
          month: next.getUTCMonth() + 1,
          day: next.getUTCDate(),
          hour: 0,
          minute: 0,
          second: 0,
        },
        event.timeZone,
      ).toISOString();
    } catch {
      intentStartAt = null;
      intentEndAt = null;
    }
  }
  return {
    eventId,
    timeZone: event.timeZone,
    dayDate: query.dayDate ?? null,
    occurrenceId: query.occurrenceId ?? null,
    intentStartAt,
    intentEndAt,
    attendanceMode: query.attendanceMode ?? null,
  };
}
export type AttendanceReportContext = Awaited<ReturnType<typeof attendanceReportContext>>;
/** Immutable recorded calendar dates classify evidence independently of current schedule settings. */
export function attendanceBaseScopeSql(alias: string) {
  return `${alias}.event_id=? AND (? IS NULL OR ${alias}.occurrence_id=?)`;
}
export function attendanceBaseScopeBindings(context: AttendanceReportContext) {
  return [context.eventId, context.occurrenceId, context.occurrenceId];
}
export function attendanceScopeSql(alias: string, context: AttendanceReportContext) {
  return `${attendanceBaseScopeSql(alias)}${context.dayDate === null ? "" : ` AND ${alias}.capture_day_date=? AND ${attendanceCapturedSql(alias)}`}`;
}
export function attendanceScopeBindings(context: AttendanceReportContext) {
  return [...attendanceBaseScopeBindings(context), ...(context.dayDate === null ? [] : [context.dayDate])];
}
export function attendanceCapturedSql(alias: string) {
  const sources = attendanceCaptureSourceSchema.options.map((source) => `'${source}'`).join(",");
  return `(COALESCE((${alias}.capture_day_date IS NOT NULL AND ${alias}.capture_time_zone IS NOT NULL AND ${alias}.capture_context_source IN (${sources}) AND (${alias}.capture_context_source NOT IN ('published_manifest','offline_grant') OR ${alias}.capture_publication_revision IS NOT NULL)),0)=1)`;
}
export function attendanceCaptureProjection(alias: string) {
  return `${alias}.capture_day_date,${alias}.capture_time_zone,${alias}.capture_publication_revision,${alias}.capture_context_source`;
}
export function attendanceRowCaptureContext(row: Record<string, unknown>) {
  return storedAttendanceCaptureContext({
    capture_day_date: typeof row.capture_day_date === "string" ? row.capture_day_date : null,
    capture_time_zone: typeof row.capture_time_zone === "string" ? row.capture_time_zone : null,
    capture_publication_revision:
      typeof row.capture_publication_revision === "number" ? row.capture_publication_revision : null,
    capture_context_source: typeof row.capture_context_source === "string" ? row.capture_context_source : null,
  });
}
