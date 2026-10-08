import { AppError } from "../../errors";
import { assertEventContactAccess, eventContactAccessSql } from "./evidence-retention";
import { effectiveAttendanceSql } from "./attendance-corrections";
import { publishedSessionsSql, publishedRoomsSql } from "./published-schedule";
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
  const bindings = [eventId, query.q ?? "", query.occurrenceId ?? null, query.occurrenceId ?? null];
  const where = "event_id=? AND INSTR(LOWER(title),LOWER(?))>0 AND (? IS NULL OR id=?)";
  const count = await first<{ total: number }>(
    db,
    `SELECT COUNT(*) AS total FROM (${publishedSessionsSql}) WHERE ${where}`,
    bindings,
  );
  const rows = await all<{ id: string; title: string; rooms_json: string }>(
    db,
    `SELECT s.id,s.title,(SELECT json_group_array(json_object('id',location.id,'name',location.name)) FROM (${publishedRoomsSql}) location WHERE location.event_id=s.event_id AND (location.id=s.room_id OR EXISTS(SELECT 1 FROM json_each(s.additional_room_ids_json) placement WHERE placement.value=location.id))) AS rooms_json FROM (${publishedSessionsSql}) s WHERE ${where} ORDER BY title ${query.sort === "-title" ? "DESC" : "ASC"},id LIMIT ? OFFSET ?`,
    [...bindings, query.limit, query.offset],
  );
  return scannerTargetsResponseSchema.parse({
    sessions: rows.map((row) => ({ id: row.id, title: row.title, rooms: JSON.parse(row.rooms_json) })),
    page: buildPageInfo(query.limit, query.offset, count?.total ?? 0, rows.length),
  });
}
export async function sessionBookings(db: DatabaseLike, eventId: string, occurrenceId: string, raw: unknown) {
  const query = sessionBookingsQuerySchema.parse(raw);
  await assertEventContactAccess(db, eventId);
  const where = `FROM agenda_session_participations p JOIN users u ON u.id=p.user_id WHERE p.event_id=? AND p.occurrence_id=? AND ${eventContactAccessSql("p.event_id")} AND (? IS NULL OR p.status=?) AND INSTR(LOWER(COALESCE(u.preferred_name,'')||' '||COALESCE(u.first_name,'')||' '||COALESCE(u.last_name,'')),LOWER(?))>0`;
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
  const participants = await all<Record<string, unknown>>(
    db,
    `SELECT p.id,p.user_id AS userId,NULLIF(TRIM(COALESCE(u.preferred_name,u.first_name,'')||' '||COALESCE(u.last_name,'')),'') AS displayName,p.attendance_mode AS attendanceMode,p.status,p.created_at AS createdAt,
 (SELECT json_object('calendarReplyDisposition',receipt.disposition,'calendarReplyReceivedAt',receipt.received_at,'calendarReplyResponse',receipt.response_status) FROM agenda_session_invitations invitation JOIN agenda_session_rsvp_receipts receipt ON receipt.invitation_id=invitation.id WHERE invitation.event_id=p.event_id AND invitation.occurrence_id=p.occurrence_id AND invitation.user_id=p.user_id ORDER BY receipt.decision_revision DESC LIMIT 1) AS calendarReplyJson ${where} ORDER BY ${sort},p.id LIMIT ? OFFSET ?`,
    [...bindings, query.limit, query.offset],
  );
  return sessionBookingsResponseSchema.parse({
    participants: participants.map(({ calendarReplyJson, ...participant }) => ({
      ...participant,
      ...(typeof calendarReplyJson === "string"
        ? JSON.parse(calendarReplyJson)
        : { calendarReplyDisposition: null, calendarReplyReceivedAt: null, calendarReplyResponse: null }),
    })),
    page: buildPageInfo(query.limit, query.offset, count?.total ?? 0, participants.length),
  });
}
export async function sessionAttendancePeople(db: DatabaseLike, eventId: string, occurrenceId: string, raw: unknown) {
  const query = attendancePeopleQuerySchema.parse(raw);
  await assertEventContactAccess(db, eventId);
  const from = `FROM event_attendance_observations o LEFT JOIN event_scan_attempts attempt ON attempt.id=o.attempt_id JOIN users u ON u.id=o.user_id WHERE COALESCE(attempt.action,'import')<>'checkout' AND ${effectiveAttendanceSql("o")} AND o.event_id=? AND o.occurrence_id=? AND ${eventContactAccessSql("o.event_id")} AND (? IS NULL OR o.attendance_mode=?) AND INSTR(LOWER(COALESCE(u.preferred_name,'')||' '||COALESCE(u.first_name,'')||' '||COALESCE(u.last_name,'')),LOWER(?))>0`;
  const bindings = [eventId, occurrenceId, query.attendanceMode ?? null, query.attendanceMode ?? null, query.q ?? ""];
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
  const retention = await first<{ active_run_id: string | null; purged_at: string | null }>(
    db,
    "SELECT active_run_id,purged_at FROM event_evidence_retention_state WHERE event_id=?",
    [eventId],
  );
  if (retention?.active_run_id || retention?.purged_at) {
    const run = await first<{ id: string; phase: string }>(
      db,
      "SELECT id,phase FROM event_evidence_retention_runs WHERE event_id=? AND (id=? OR status='complete') ORDER BY started_at DESC LIMIT 1",
      [eventId, retention.active_run_id],
    );
    if (!run)
      throw new AppError(409, "EVIDENCE_RETENTION_IN_PROGRESS", "The retained attendance report is being prepared.");
    const missing = await first<{ total: number }>(
      db,
      `SELECT COUNT(*) AS total FROM (${publishedSessionsSql}) s WHERE ${where} AND NOT EXISTS(SELECT 1 FROM event_evidence_retention_grains grain WHERE grain.run_id=? AND grain.scope_key=json_array(NULL,s.id,?)) OR (${where} AND NOT EXISTS(SELECT 1 FROM event_evidence_retention_grains grain WHERE grain.run_id=? AND grain.scope_key=json_array(NULL,s.id,NULL)))`,
      [...values, run.id, query.attendanceMode ?? null, ...values, run.id],
    );
    if (missing?.total)
      throw new AppError(
        409,
        "EVIDENCE_RETENTION_IN_PROGRESS",
        "Complete retained session populations are still being prepared.",
      );
    const sessions = await all(
      db,
      `SELECT s.id AS occurrenceId,s.title,
      COALESCE((SELECT SUM(count) FROM event_evidence_retention_reasons reason WHERE reason.run_id=? AND reason.scope_key=json_array(NULL,s.id,NULL)||':all_scans'),0) AS scans,
      COALESCE((SELECT SUM(count) FROM event_evidence_retention_reasons reason WHERE reason.run_id=? AND reason.scope_key=json_array(NULL,s.id,NULL)||':all_scans' AND reason.outcome<>'eligible'),0) AS unsuccessful,
      json_extract(selected.summary_json,'$.observed.uniquePeople') AS attendees,
      json_extract(all_modes.summary_json,'$.observed.physicalPeople') AS physicalAttendees,
      json_extract(all_modes.summary_json,'$.observed.virtualPeople') AS virtualAttendees
      FROM (${publishedSessionsSql}) s
      JOIN event_evidence_retention_grains selected ON selected.run_id=? AND selected.scope_key=json_array(NULL,s.id,?)
      JOIN event_evidence_retention_grains all_modes ON all_modes.run_id=? AND all_modes.scope_key=json_array(NULL,s.id,NULL)
      WHERE ${where} ORDER BY ${order},s.id LIMIT ? OFFSET ?`,
      [run.id, run.id, run.id, query.attendanceMode ?? null, run.id, ...values, query.limit, query.offset],
    );
    return attendanceReportSchema.parse({
      sessions,
      page: buildPageInfo(query.limit, query.offset, count?.total ?? 0, sessions.length),
    });
  }
  const sessions = await all(
    db,
    `WITH attempts AS (
      SELECT occurrence_id,COUNT(*) AS scans,SUM(outcome<>'eligible') AS unsuccessful FROM event_scan_attempts WHERE event_id=? GROUP BY occurrence_id
    ), observations AS (
      SELECT o.occurrence_id,COUNT(DISTINCT CASE WHEN (? IS NULL OR o.attendance_mode=?) THEN o.user_id END) AS attendees,
      COUNT(DISTINCT CASE WHEN o.attendance_mode='physical' THEN o.user_id END) AS physicalAttendees,
      COUNT(DISTINCT CASE WHEN o.attendance_mode='virtual' THEN o.user_id END) AS virtualAttendees
      FROM event_attendance_observations o LEFT JOIN event_scan_attempts attempt ON attempt.id=o.attempt_id WHERE COALESCE(attempt.action,'import')<>'checkout' AND o.event_id=? AND ${effectiveAttendanceSql("o")} GROUP BY o.occurrence_id
    ) SELECT s.id AS occurrenceId,s.title,COALESCE(attempts.scans,0) AS scans,COALESCE(attempts.unsuccessful,0) AS unsuccessful,
    COALESCE(observations.attendees,0) AS attendees,COALESCE(observations.physicalAttendees,0) AS physicalAttendees,COALESCE(observations.virtualAttendees,0) AS virtualAttendees
    FROM (${publishedSessionsSql}) s LEFT JOIN attempts ON attempts.occurrence_id=s.id LEFT JOIN observations ON observations.occurrence_id=s.id WHERE ${where} ORDER BY ${order},s.id LIMIT ? OFFSET ?`,
    [
      eventId,
      query.attendanceMode ?? null,
      query.attendanceMode ?? null,
      eventId,
      ...values,
      query.limit,
      query.offset,
    ],
  );
  return attendanceReportSchema.parse({
    sessions,
    page: buildPageInfo(query.limit, query.offset, count?.total ?? 0, sessions.length),
  });
}
