import { attendanceCaptureProjection, attendanceRowCaptureContext } from "./attendance-report-context";
import { assertEventContactAccess, eventContactAccessSql } from "./evidence-retention";
import {
  attendanceCorrectionRequestSchema,
  attendanceCorrectionSchema,
  attendanceEvidenceQuerySchema,
  attendanceEvidenceResponseSchema,
  attendanceCorrectionHistoryQuerySchema,
  attendanceCorrectionHistoryResponseSchema,
} from "../../../../assets/shared/schemas/event-attendance-corrections";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { first, all } from "../../db/queries";
import { prepareScopedAuditLog } from "../audit";
import type { DatabaseLike } from "../../types";
import { AppError } from "../../errors";
import { nowIso } from "../../utils/time";
/** Raw observations and original attempts are never rewritten; corrections live alongside them. */
export function effectiveAttendanceSql(observationAlias: string) {
  return `NOT EXISTS(SELECT 1 FROM event_attendance_correction_state correction WHERE correction.observation_id=${observationAlias}.id AND correction.voided=1)`;
}
const correctionProjection =
  "id,observation_id AS observationId,actor_user_id AS actorUserId,operation_id AS operationId,revision,kind,reason_code AS reasonCode,created_at AS createdAt";
export async function correctAttendance(
  db: DatabaseLike,
  eventId: string,
  observationId: string,
  actorId: string,
  raw: unknown,
) {
  const input = attendanceCorrectionRequestSchema.parse(raw);
  const prior = await first<Record<string, unknown>>(
    db,
    `SELECT ${correctionProjection} FROM event_attendance_corrections WHERE operation_id=?`,
    [input.operationId],
  );
  if (prior) {
    if (
      prior.observationId !== observationId ||
      prior.actorUserId !== actorId ||
      prior.kind !== input.kind ||
      prior.reasonCode !== input.reasonCode ||
      prior.revision !== input.expectedRevision + 1
    )
      throw new AppError(
        409,
        "ATTENDANCE_CORRECTION_OPERATION_CONFLICT",
        "This operation was already used for a different correction.",
      );
    const belongs = await first(db, "SELECT 1 FROM event_attendance_observations WHERE id=? AND event_id=?", [
      observationId,
      eventId,
    ]);
    if (!belongs) throw new AppError(404, "ATTENDANCE_OBSERVATION_NOT_FOUND", "Attendance evidence unavailable.");
    return attendanceCorrectionSchema.parse(prior);
  }
  if (
    !(await first(db, "SELECT 1 FROM event_attendance_observations WHERE id=? AND event_id=?", [
      observationId,
      eventId,
    ]))
  )
    throw new AppError(404, "ATTENDANCE_OBSERVATION_NOT_FOUND", "Attendance evidence unavailable.");
  const evidence = {
    sql: `SELECT 1 FROM event_attendance_observations observation LEFT JOIN event_attendance_correction_state state ON state.observation_id=observation.id WHERE observation.id=? AND observation.event_id=? AND COALESCE(state.revision,0)=? AND COALESCE(state.voided,0)=?`,
    bindings: [observationId, eventId, input.expectedRevision, input.kind === "void" ? 0 : 1],
  };
  if (!(await first(db, evidence.sql, evidence.bindings))) {
    if (await first(db, "SELECT 1 FROM event_attendance_corrections WHERE operation_id=?", [input.operationId]))
      return correctAttendance(db, eventId, observationId, actorId, input);
    throw new AppError(409, "ATTENDANCE_EVIDENCE_CHANGED", "Reload the evidence before applying this correction.");
  }
  const guardId = crypto.randomUUID();
  const id = crypto.randomUUID(),
    createdAt = nowIso(),
    revision = input.expectedRevision + 1;
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO event_attendance_correction_guards(id,valid) SELECT ?,CASE WHEN EXISTS(${evidence.sql}) THEN 1 ELSE 0 END`,
        )
        .bind(guardId, ...evidence.bindings),
      db
        .prepare(
          "INSERT INTO event_attendance_corrections(id,observation_id,event_id,actor_user_id,operation_id,revision,kind,reason_code,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          id,
          observationId,
          eventId,
          actorId,
          input.operationId,
          revision,
          input.kind,
          input.reasonCode,
          createdAt,
        ),
      db
        .prepare(
          "INSERT INTO event_attendance_correction_state(observation_id,revision,voided) VALUES(?,?,?) ON CONFLICT(observation_id) DO UPDATE SET revision=excluded.revision,voided=excluded.voided",
        )
        .bind(observationId, revision, input.kind === "void" ? 1 : 0),
      prepareScopedAuditLog(
        db,
        { type: "event", id: eventId },
        "user",
        actorId,
        "agenda.attendance.corrected",
        "attendance_observation",
        observationId,
        { kind: input.kind, reasonCode: input.reasonCode, revision },
      ),
      db.prepare("DELETE FROM event_attendance_correction_guards WHERE id=?").bind(guardId),
    ]);
  } catch (error) {
    if (error instanceof Error && error.message.includes("attendance_correction_revision_valid")) {
      if (await first(db, "SELECT 1 FROM event_attendance_corrections WHERE operation_id=?", [input.operationId]))
        return correctAttendance(db, eventId, observationId, actorId, input);
      throw new AppError(409, "ATTENDANCE_EVIDENCE_CHANGED", "Reload the evidence before applying this correction.");
    }
    throw error;
  }
  return attendanceCorrectionSchema.parse({
    id,
    observationId,
    actorUserId: actorId,
    operationId: input.operationId,
    kind: input.kind,
    reasonCode: input.reasonCode,
    revision,
    createdAt,
  });
}
export async function attendanceEvidence(db: DatabaseLike, eventId: string, raw: unknown) {
  const query = attendanceEvidenceQuerySchema.parse(raw);
  await assertEventContactAccess(db, eventId);
  const from = `FROM event_attendance_observations o JOIN users person ON person.id=o.user_id LEFT JOIN event_scan_attempts attempt ON attempt.id=o.attempt_id LEFT JOIN event_attendance_import_provenance provenance ON provenance.observation_id=o.id LEFT JOIN event_attendance_imports imported ON imported.id=provenance.import_id LEFT JOIN event_attendance_correction_state state ON state.observation_id=o.id WHERE o.event_id=? AND ${eventContactAccessSql("o.event_id")} AND (? IS NULL OR o.occurrence_id=?) AND (? IS NULL OR o.user_id=?)`;
  const bindings = [
    eventId,
    query.occurrenceId ?? null,
    query.occurrenceId ?? null,
    query.userId ?? null,
    query.userId ?? null,
  ];
  const count = await first<{ total: number }>(db, `SELECT COUNT(*) AS total ${from}`, bindings);
  const rows = await all<Record<string, unknown>>(
    db,
    `SELECT ${attendanceCaptureProjection("o")},o.id,o.user_id AS userId,NULLIF(TRIM(COALESCE(person.preferred_name,person.first_name,'')||' '||COALESCE(person.last_name,'')),'') AS displayName,o.occurrence_id AS occurrenceId,o.observed_at AS observedAt,COALESCE(attempt.created_at,imported.received_at) AS receivedAt,COALESCE(attempt.operator_user_id,imported.actor_user_id) AS operatorUserId,attempt.device_id AS deviceId,COALESCE(provenance.verification,'unverified') AS providerVerification,provenance.source_reference AS sourceReference,o.attendance_mode AS attendanceMode,CASE WHEN provenance.observation_id IS NOT NULL THEN provenance.source WHEN EXISTS(SELECT 1 FROM event_offline_admission_spends spent WHERE spent.operation_id=attempt.operation_id) THEN 'offline_authorized_scan' ELSE 'browser_scan' END AS source,COALESCE(attempt.action,'import') AS action,COALESCE(state.revision,0) AS revision,COALESCE(state.voided,0) AS voided ${from} ORDER BY o.observed_at ${query.sort === "-observedAt" ? "DESC" : "ASC"},o.id LIMIT ? OFFSET ?`,
    [...bindings, query.limit, query.offset],
  );
  return attendanceEvidenceResponseSchema.parse({
    observations: rows.map((row) => ({
      ...row,
      captureContext: attendanceRowCaptureContext(row),
      voided: Boolean(row.voided),
      deviceTimeVerified: false,
    })),
    page: buildPageInfo(query.limit, query.offset, count?.total ?? 0, rows.length),
    retentionPolicy: "retained_with_original_observation",
  });
}
export async function attendanceCorrectionHistory(
  db: DatabaseLike,
  eventId: string,
  observationId: string,
  raw: unknown,
) {
  const query = attendanceCorrectionHistoryQuerySchema.parse(raw);
  await assertEventContactAccess(db, eventId);
  if (
    !(await first(db, "SELECT 1 FROM event_attendance_observations WHERE id=? AND event_id=?", [
      observationId,
      eventId,
    ]))
  )
    throw new AppError(404, "ATTENDANCE_OBSERVATION_NOT_FOUND", "Attendance evidence unavailable.");
  const count = await first<{ total: number }>(
    db,
    `SELECT COUNT(*) AS total FROM event_attendance_corrections WHERE event_id=? AND observation_id=? AND ${eventContactAccessSql("event_attendance_corrections.event_id")}`,
    [eventId, observationId],
  );
  const corrections = await all(
    db,
    `SELECT ${correctionProjection} FROM event_attendance_corrections WHERE event_id=? AND observation_id=? AND ${eventContactAccessSql("event_attendance_corrections.event_id")} ORDER BY revision ${query.sort === "-revision" ? "DESC" : "ASC"} LIMIT ? OFFSET ?`,
    [eventId, observationId, query.limit, query.offset],
  );
  return attendanceCorrectionHistoryResponseSchema.parse({
    corrections,
    page: buildPageInfo(query.limit, query.offset, count?.total ?? 0, corrections.length),
  });
}
