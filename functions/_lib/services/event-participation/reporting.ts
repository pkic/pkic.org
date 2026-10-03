import { publishedSessionsSql } from "./published-schedule";
import { all, first } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import {
  attendanceQuerySchema,
  attendanceReportSchema,
  attendancePeopleQuerySchema,
  attendancePeopleResponseSchema,
  sessionBookingsQuerySchema,
  sessionBookingsResponseSchema,
} from "../../../../assets/shared/schemas/event-participation-reporting";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import {
  scannerTargetQuerySchema,
  scannerTargetsResponseSchema,
} from "../../../../assets/shared/schemas/event-participation-scanning";
export async function scannerTargets(db: DatabaseLike, eventId: string, raw: unknown) {
  const query = scannerTargetQuerySchema.parse(raw);
  const bindings = [eventId, query.q ?? ""];
  const where = "event_id=? AND INSTR(LOWER(title),LOWER(?))>0";
  const count = await first<{ total: number }>(
    db,
    `SELECT COUNT(*) AS total FROM (${publishedSessionsSql}) WHERE ${where}`,
    bindings,
  );
  const sessions = await all(
    db,
    `SELECT id,title FROM (${publishedSessionsSql}) WHERE ${where} ORDER BY title ${query.sort === "-title" ? "DESC" : "ASC"},id LIMIT ? OFFSET ?`,
    [...bindings, query.limit, query.offset],
  );
  return scannerTargetsResponseSchema.parse({
    sessions,
    page: buildPageInfo(query.limit, query.offset, count?.total ?? 0, sessions.length),
  });
}
export async function sessionBookings(db: DatabaseLike, eventId: string, occurrenceId: string, raw: unknown) {
  const query = sessionBookingsQuerySchema.parse(raw);
  const where =
    "FROM agenda_session_participations p JOIN users u ON u.id=p.user_id WHERE p.event_id=? AND p.occurrence_id=? AND (? IS NULL OR p.status=?) AND INSTR(LOWER(COALESCE(u.preferred_name,'')||' '||COALESCE(u.first_name,'')||' '||COALESCE(u.last_name,'')),LOWER(?))>0";
  const bindings = [eventId, occurrenceId, query.status ?? null, query.status ?? null, query.q ?? ""];
  const count = await first<{ total: number }>(db, `SELECT COUNT(*) AS total ${where}`, bindings);
  const sort =
    query.sort === "name"
      ? "displayName ASC"
      : query.sort === "-name"
        ? "displayName DESC"
        : query.sort === "-createdAt"
          ? "p.created_at DESC"
          : "p.created_at ASC";
  const participants = await all(
    db,
    `SELECT p.id,p.user_id AS userId,NULLIF(TRIM(COALESCE(u.preferred_name,u.first_name,'')||' '||COALESCE(u.last_name,'')),'') AS displayName,p.attendance_mode AS attendanceMode,p.status,p.created_at AS createdAt ${where} ORDER BY ${sort},p.id LIMIT ? OFFSET ?`,
    [...bindings, query.limit, query.offset],
  );
  return sessionBookingsResponseSchema.parse({
    participants,
    page: buildPageInfo(query.limit, query.offset, count?.total ?? 0, participants.length),
  });
}
export async function sessionAttendancePeople(db: DatabaseLike, eventId: string, occurrenceId: string, raw: unknown) {
  const query = attendancePeopleQuerySchema.parse(raw);
  const from =
    "FROM event_attendance_observations o JOIN users u ON u.id=o.user_id WHERE o.event_id=? AND o.occurrence_id=? AND INSTR(LOWER(COALESCE(u.preferred_name,'')||' '||COALESCE(u.first_name,'')||' '||COALESCE(u.last_name,'')),LOWER(?))>0";
  const bindings = [eventId, occurrenceId, query.q ?? ""];
  const count = await first<{ total: number }>(db, `SELECT COUNT(DISTINCT o.user_id) AS total ${from}`, bindings);
  const sort =
    query.sort === "name"
      ? "displayName ASC"
      : query.sort === "-name"
        ? "displayName DESC"
        : query.sort === "-firstObservedAt"
          ? "firstObservedAt DESC"
          : "firstObservedAt ASC";
  const attendees = await all(
    db,
    `SELECT o.user_id AS userId,NULLIF(TRIM(COALESCE(u.preferred_name,u.first_name,'')||' '||COALESCE(u.last_name,'')),'') AS displayName,COUNT(*) AS observationCount,MIN(o.observed_at) AS firstObservedAt,MAX(o.observed_at) AS lastObservedAt ${from} GROUP BY o.user_id ORDER BY ${sort},o.user_id LIMIT ? OFFSET ?`,
    [...bindings, query.limit, query.offset],
  );
  return attendancePeopleResponseSchema.parse({
    attendees,
    page: buildPageInfo(query.limit, query.offset, count?.total ?? 0, attendees.length),
  });
}

export async function attendanceReport(db: DatabaseLike, eventId: string, raw: unknown) {
  const query = attendanceQuerySchema.parse(raw);
  const values = [eventId, query.occurrenceId ?? null, query.occurrenceId ?? null, query.q ?? ""];
  const where = "s.event_id=? AND (? IS NULL OR s.id=?) AND INSTR(LOWER(s.title),LOWER(?))>0";
  const count = await first<{ total: number }>(
    db,
    `SELECT COUNT(*) AS total FROM (${publishedSessionsSql}) s WHERE ${where}`,
    values,
  );
  const order =
    query.sort === "attendance"
      ? "attendees ASC"
      : query.sort === "-attendance"
        ? "attendees DESC"
        : query.sort === "-title"
          ? "s.title DESC"
          : "s.title ASC";
  const sessions = await all(
    db,
    `SELECT s.id AS occurrenceId,s.title,
    (SELECT COUNT(*) FROM event_scan_attempts a WHERE a.event_id=s.event_id AND a.occurrence_id=s.id) AS scans,
    (SELECT COUNT(*) FROM event_scan_attempts a WHERE a.event_id=s.event_id AND a.occurrence_id=s.id AND a.outcome<>'eligible') AS unsuccessful,
    (SELECT COUNT(DISTINCT o.user_id) FROM event_attendance_observations o WHERE o.event_id=s.event_id AND o.occurrence_id=s.id) AS attendees
    FROM (${publishedSessionsSql}) s WHERE ${where} ORDER BY ${order},s.id LIMIT ? OFFSET ?`,
    [...values, query.limit, query.offset],
  );
  return attendanceReportSchema.parse({
    sessions,
    page: buildPageInfo(query.limit, query.offset, count?.total ?? 0, sessions.length),
  });
}
