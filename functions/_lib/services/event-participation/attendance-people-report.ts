import { assertEventContactAccess, eventContactAccessSql } from "./evidence-retention";
import {
  eventAttendancePeopleQuerySchema,
  eventAttendancePeopleResponseSchema,
} from "../../../../assets/shared/schemas/event-attendance-reporting";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { all, first } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { effectiveAttendanceSql } from "./attendance-corrections";
import { publishedSessionsSql } from "./published-schedule";
import {
  attendanceReportContext,
  attendanceScopeSql,
  attendanceScopeBindings,
  attendanceCapturedSql,
} from "./attendance-report-context";
export async function attendancePeopleQuery(db: DatabaseLike, eventId: string, raw: unknown) {
  const query = eventAttendancePeopleQuerySchema.parse(raw),
    context = await attendanceReportContext(db, eventId, query);
  await assertEventContactAccess(db, eventId);
  const observed = `SELECT o.user_id,MIN(o.observed_at) AS firstObservedAt,MAX(o.observed_at) AS lastObservedAt,COUNT(*) AS observationCount,SUM(NOT (${attendanceCapturedSql("o")})) AS missingContextObservations,COUNT(DISTINCT CASE WHEN ${attendanceCapturedSql("o")} THEN o.capture_time_zone END) AS capturedTimeZones,SUM(o.attendance_mode='physical') AS physicalObservations,SUM(o.attendance_mode='virtual') AS virtualObservations,SUM(provenance.observation_id IS NOT NULL) AS importedObservations,SUM(o.attendance_mode='virtual' AND COALESCE(provenance.verification,'unverified')='provider_verified') AS providerAssertedVirtualObservations FROM event_attendance_observations o LEFT JOIN event_attendance_import_provenance provenance ON provenance.observation_id=o.id LEFT JOIN event_scan_attempts attempt ON attempt.id=o.attempt_id WHERE ${eventContactAccessSql("o.event_id")} AND ${attendanceScopeSql("o", context)} AND ${effectiveAttendanceSql("o")} AND (? IS NULL OR o.attendance_mode=?) AND COALESCE(attempt.action,'import') NOT IN ('checkout','check_out') GROUP BY o.user_id`;
  const observedValues = [...attendanceScopeBindings(context), context.attendanceMode, context.attendanceMode];
  const intent = `SELECT participation.user_id,SUM(participation.status='reserved') AS reservedSessions,SUM(participation.status='saved') AS savedSessions,SUM(participation.status='approval_pending') AS approvalPendingSessions FROM agenda_session_participations participation LEFT JOIN (${publishedSessionsSql}) session ON session.event_id=participation.event_id AND session.id=participation.occurrence_id WHERE participation.event_id=? AND (? IS NULL OR participation.occurrence_id=?) AND (? IS NULL OR participation.attendance_mode=?) AND (? IS NULL OR (session.start_at<? AND session.end_at>?)) GROUP BY participation.user_id`;
  const sort = query.sort?.replace("-", "") === "name" ? "displayName" : "firstObservedAt",
    direction = query.sort?.startsWith("-") ? "DESC" : "ASC";
  return {
    currentIntent: {
      timeZone: context.timeZone,
      startAt: context.intentStartAt,
      endAt: context.intentEndAt,
      dayIntervalAvailable: context.dayDate === null || context.intentStartAt !== null,
    },
    sql: `WITH observed AS (${observed}),intent AS (${intent}) SELECT observed.user_id AS userId,NULLIF(TRIM(COALESCE(person.preferred_name,person.first_name,'')||' '||COALESCE(person.last_name,'')),'') AS displayName,observed.firstObservedAt,observed.lastObservedAt,observed.observationCount,observed.missingContextObservations,observed.capturedTimeZones,observed.physicalObservations,observed.virtualObservations,observed.importedObservations,observed.providerAssertedVirtualObservations,COALESCE(intent.reservedSessions,0) AS reservedSessions,COALESCE(intent.savedSessions,0) AS savedSessions,COALESCE(intent.approvalPendingSessions,0) AS approvalPendingSessions FROM observed JOIN users person ON person.id=observed.user_id LEFT JOIN intent ON intent.user_id=observed.user_id WHERE INSTR(LOWER(COALESCE(person.preferred_name,'')||' '||COALESCE(person.first_name,'')||' '||COALESCE(person.last_name,'')),LOWER(?))>0`,
    bindings: [
      ...observedValues,
      eventId,
      context.occurrenceId,
      context.occurrenceId,
      context.attendanceMode,
      context.attendanceMode,
      context.dayDate,
      context.intentEndAt,
      context.intentStartAt,
      query.q ?? "",
    ],
    order: `${sort} ${direction},userId`,
  };
}
export async function eventAttendancePeople(db: DatabaseLike, eventId: string, raw: unknown) {
  const query = eventAttendancePeopleQuerySchema.parse(raw);
  const built = await attendancePeopleQuery(db, eventId, query);
  const count = await first<{ total: number }>(db, `SELECT COUNT(*) AS total FROM (${built.sql})`, built.bindings);
  const attendees = await all(db, `${built.sql} ORDER BY ${built.order} LIMIT ? OFFSET ?`, [
    ...built.bindings,
    query.limit,
    query.offset,
  ]);
  return eventAttendancePeopleResponseSchema.parse({
    attendees,
    page: buildPageInfo(query.limit, query.offset, count?.total ?? 0, attendees.length),
  });
}
