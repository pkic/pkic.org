import { retainedAttendanceScope } from "./retained-attendance-scope";
import { assertEventContactAccess, eventContactAccessSql } from "./evidence-retention";
import {
  attendanceAttemptQuerySchema,
  attendanceAttemptsResponseSchema,
  attendanceReasonsQuerySchema,
  attendanceReasonsResponseSchema,
} from "../../../../assets/shared/schemas/event-attendance-reporting";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { all, first } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import {
  attendanceReportContext,
  attendanceScopeSql,
  attendanceScopeBindings,
  attendanceCaptureProjection,
  attendanceRowCaptureContext,
} from "./attendance-report-context";
export async function attendanceAttemptsQuery(db: DatabaseLike, eventId: string, raw: unknown) {
  const query = attendanceAttemptQuerySchema.parse(raw),
    context = await attendanceReportContext(db, eventId, query);
  await assertEventContactAccess(db, eventId);
  const from = `FROM event_scan_attempts a JOIN users person ON person.id=a.user_id WHERE ${eventContactAccessSql("a.event_id")} AND ${attendanceScopeSql("a", context)} AND a.action<>'lead' AND (? IS NULL OR ?='physical') AND (? IS NULL OR a.user_id=?) AND (? IS NULL OR a.action=?) AND (? IS NULL OR a.reason=?) AND (? IS NULL OR (a.outcome<>'eligible')=?) AND INSTR(LOWER(COALESCE(person.preferred_name,'')||' '||COALESCE(person.first_name,'')||' '||COALESCE(person.last_name,'')),LOWER(?))>0`;
  const values = [
    ...attendanceScopeBindings(context),
    context.attendanceMode,
    context.attendanceMode,
    query.userId ?? null,
    query.userId ?? null,
    query.action ?? null,
    query.action ?? null,
    query.reason ?? null,
    query.reason ?? null,
    query.unsuccessful === undefined ? null : Number(query.unsuccessful),
    query.unsuccessful === undefined ? null : Number(query.unsuccessful),
    query.q ?? "",
  ];
  const column = query.sort?.replace("-", "") === "receivedAt" ? "a.created_at" : "a.observed_at",
    direction = query.sort?.startsWith("-") ? "DESC" : "ASC";
  return {
    sql: `SELECT ${attendanceCaptureProjection("a")},a.id AS id,a.user_id AS userId,NULLIF(TRIM(COALESCE(person.preferred_name,person.first_name,'')||' '||COALESCE(person.last_name,'')),'') AS displayName,a.occurrence_id AS occurrenceId,a.operator_user_id AS operatorUserId,a.device_id AS deviceId,a.action,a.outcome,a.reason,a.exception_reason AS exceptionReason,a.admission_decision AS admissionDecision,a.observed_at AS observedAt,a.created_at AS receivedAt,EXISTS(SELECT 1 FROM event_offline_admission_spends spent WHERE spent.operation_id=a.operation_id) AS offlineReconciled ${from}`,
    bindings: values,
    order: `${column === "a.created_at" ? "receivedAt" : "observedAt"} ${direction},id`,
  };
}
export async function eventAttendanceAttempts(db: DatabaseLike, eventId: string, raw: unknown) {
  const query = attendanceAttemptQuerySchema.parse(raw),
    built = await attendanceAttemptsQuery(db, eventId, query);
  const count = await first<{ total: number }>(db, `SELECT COUNT(*) AS total FROM (${built.sql})`, built.bindings);
  const attempts = await all<Record<string, unknown>>(db, `${built.sql} ORDER BY ${built.order} LIMIT ? OFFSET ?`, [
    ...built.bindings,
    query.limit,
    query.offset,
  ]);
  return attendanceAttemptsResponseSchema.parse({
    attempts: attempts.map((attempt) => ({
      ...attempt,
      captureContext: attendanceRowCaptureContext(attempt),
      offlineReconciled: Boolean(attempt.offlineReconciled),
      clockVerification: "unverified",
    })),
    page: buildPageInfo(query.limit, query.offset, count?.total ?? 0, attempts.length),
  });
}
export async function eventAttendanceReasons(db: DatabaseLike, eventId: string, raw: unknown) {
  const query = attendanceReasonsQuerySchema.parse(raw),
    context = await attendanceReportContext(db, eventId, query);
  const retained = await retainedAttendanceScope(db, eventId, query, context);
  if (retained) {
    if (retained.empty)
      return attendanceReasonsResponseSchema.parse({
        reasons: [],
        page: buildPageInfo(query.limit, query.offset, 0, 0),
      });
    const from =
      "FROM event_evidence_retention_reasons WHERE run_id=? AND scope_key=? AND INSTR(LOWER(reason),LOWER(?))>0";
    const values = [retained.runId, retained.scopeKey, query.q ?? ""];
    const total = await first<{ total: number }>(db, `SELECT COUNT(*) AS total ${from}`, values);
    const sort = query.sort?.replace("-", "") === "reason" ? "reason" : "count",
      direction = query.sort?.startsWith("-") ? "DESC" : "ASC";
    const rows = await all<{ action: string; outcome: string; reason: string; count: number }>(
      db,
      `SELECT action,outcome,reason,count ${from} ORDER BY ${sort} ${direction},action,outcome,reason LIMIT ? OFFSET ?`,
      [...values, query.limit, query.offset],
    );
    return attendanceReasonsResponseSchema.parse({
      reasons: rows.map((row) => ({
        ...row,
        exceptionReason: null,
        key: JSON.stringify([row.action, row.outcome, row.reason, null]),
      })),
      page: buildPageInfo(query.limit, query.offset, total?.total ?? 0, rows.length),
    });
  }
  const exceptionExplanation = `CASE WHEN ${eventContactAccessSql("a.event_id")} THEN a.exception_reason ELSE NULL END`;
  const grouped = `SELECT a.action,a.outcome,a.reason,${exceptionExplanation} AS exceptionReason,COUNT(*) AS count FROM event_scan_attempts a WHERE ${attendanceScopeSql("a", context)} AND a.user_id IS NOT NULL AND a.action<>'lead' AND (? IS NULL OR ?='physical') GROUP BY a.action,a.outcome,a.reason,${exceptionExplanation}`;
  const searched = `FROM (${grouped}) reason_group WHERE INSTR(LOWER(COALESCE(reason_group.reason,'')||' '||COALESCE(reason_group.exceptionReason,'')),LOWER(?))>0`;
  const values = [...attendanceScopeBindings(context), context.attendanceMode, context.attendanceMode, query.q ?? ""];
  const count = await first<{ total: number }>(db, `SELECT COUNT(*) AS total ${searched}`, values);
  const sort = query.sort?.replace("-", "") === "reason" ? "reason" : "count",
    direction = query.sort?.startsWith("-") ? "DESC" : "ASC";
  const reasons = await all<Record<string, unknown>>(
    db,
    `SELECT action,outcome,reason,exceptionReason,count ${searched} ORDER BY ${sort} ${direction},action,outcome,reason,exceptionReason LIMIT ? OFFSET ?`,
    [...values, query.limit, query.offset],
  );
  return attendanceReasonsResponseSchema.parse({
    reasons: reasons.map((reason) => ({
      ...reason,
      key: JSON.stringify([reason.action, reason.outcome, reason.reason, reason.exceptionReason]),
    })),
    page: buildPageInfo(query.limit, query.offset, count?.total ?? 0, reasons.length),
  });
}
