import { retainedAttendanceScope } from "./retained-attendance-scope";
import { readEventContactRetention } from "./evidence-retention";
import { eventScannerReconciliation } from "./scanner-reconciliation";
import {
  attendanceScopeQuerySchema,
  attendanceSummarySchema,
} from "../../../../assets/shared/schemas/event-attendance-reporting";
import { first } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { effectiveAttendanceSql } from "./attendance-corrections";
import {
  attendanceReportContext,
  attendanceScopeSql,
  attendanceScopeBindings,
  attendanceBaseScopeSql,
  attendanceBaseScopeBindings,
  attendanceCapturedSql,
} from "./attendance-report-context";
export async function materializeEventAttendanceSummary(db: DatabaseLike, eventId: string, raw: unknown) {
  const query = attendanceScopeQuerySchema.parse(raw),
    context = await attendanceReportContext(db, eventId, query),
    generatedAt = nowIso();
  const observed = await first<Record<string, number>>(
    db,
    `WITH original AS (
 SELECT o.id,o.user_id,o.occurrence_id,o.attendance_mode,o.observed_at,COALESCE(attempt.action,'import') AS action,
 CASE WHEN ${effectiveAttendanceSql("o")} THEN 1 ELSE 0 END AS effective,provenance.verification,
 CASE WHEN provenance.observation_id IS NOT NULL THEN 1 ELSE 0 END AS imported,
 CASE WHEN spent.operation_id IS NOT NULL THEN 1 ELSE 0 END AS offline
 FROM event_attendance_observations o LEFT JOIN event_scan_attempts attempt ON attempt.id=o.attempt_id
 LEFT JOIN event_attendance_import_provenance provenance ON provenance.observation_id=o.id
 LEFT JOIN event_offline_admission_spends spent ON spent.operation_id=attempt.operation_id
 WHERE ${attendanceScopeSql("o", context)} AND (? IS NULL OR o.attendance_mode=?)
 ), presence AS (SELECT id,user_id,occurrence_id,attendance_mode,observed_at,verification,imported FROM original WHERE effective=1 AND action NOT IN ('checkout','check_out')), entries AS (SELECT id,user_id,occurrence_id,attendance_mode,observed_at,verification,ROW_NUMBER() OVER(PARTITION BY user_id,occurrence_id,attendance_mode ORDER BY observed_at,id) AS ordinal FROM presence WHERE imported=0)
 SELECT (SELECT COUNT(DISTINCT user_id) FROM presence) AS uniquePeople,
 (SELECT COUNT(DISTINCT user_id) FROM presence WHERE attendance_mode='physical') AS physicalPeople,
 (SELECT COUNT(DISTINCT user_id) FROM presence WHERE attendance_mode='virtual') AS virtualPeople,
 (SELECT COUNT(DISTINCT user_id) FROM presence WHERE attendance_mode='virtual' AND verification='provider_verified') AS providerAssertedVirtualPeople,
 COUNT(*) AS originalObservations,COALESCE(SUM(effective),0) AS effectiveObservations,COALESCE(SUM(1-effective),0) AS voidedObservations,
 (SELECT COUNT(*) FROM entries WHERE ordinal=1) AS entryObservations,(SELECT COUNT(*) FROM entries WHERE ordinal>1) AS reentryObservations,
 COALESCE(SUM(CASE WHEN effective=1 AND action IN ('checkout','check_out') THEN 1 ELSE 0 END),0) AS checkoutObservations,
 COALESCE(SUM(CASE WHEN effective=1 THEN imported ELSE 0 END),0) AS importedObservations,
 COALESCE(SUM(CASE WHEN effective=1 THEN offline ELSE 0 END),0) AS offlineAuthorizedObservations FROM original`,
    [...attendanceScopeBindings(context), context.attendanceMode, context.attendanceMode],
  );
  const attempts = await first(
    db,
    `SELECT COUNT(*) AS recognized,COALESCE(SUM(CASE WHEN a.outcome='eligible' THEN 1 ELSE 0 END),0) AS successful,COALESCE(SUM(CASE WHEN a.outcome<>'eligible' THEN 1 ELSE 0 END),0) AS unsuccessful,COALESCE(SUM(a.outcome='denied'),0) AS businessDenials,COALESCE(SUM(a.outcome='warning'),0) AS warnings,COALESCE(SUM(a.outcome='unverified'),0) AS unverified,COALESCE(SUM(a.action='check'),0) AS checks,COALESCE(SUM(a.action='admission'),0) AS admissions,COALESCE(SUM(a.admission_decision='allowed'),0) AS admissionAllowed,COALESCE(SUM(a.admission_decision='refused'),0) AS admissionRefused,COALESCE(SUM(a.admission_decision='unresolved'),0) AS admissionUnresolved,COALESCE(SUM(a.action IN ('admission','exception') AND a.admission_decision IS NULL),0) AS admissionUnknown,COUNT(DISTINCT CASE WHEN a.admission_decision='allowed' THEN a.user_id END) AS uniqueAllowedAdmissionPeople,COALESCE(SUM(a.action='attendance'),0) AS attendance,COALESCE(SUM(a.action='exception'),0) AS exceptions FROM event_scan_attempts a WHERE ${attendanceScopeSql("a", context)} AND a.user_id IS NOT NULL AND a.action<>'lead' AND (? IS NULL OR ?='physical')`,
    [...attendanceScopeBindings(context), context.attendanceMode, context.attendanceMode],
  );
  const sync = await first<Record<string, number>>(
    db,
    `WITH grants AS (SELECT g.id,g.device_id,g.closed_at,g.revoked_at,g.expires_at,g.quantity FROM event_offline_admission_grants g WHERE g.event_id=? AND (? IS NULL OR g.occurrence_id=?) AND (? IS NULL OR g.day_date=?)),spends AS (SELECT spent.grant_id,COUNT(*) AS reconciled,SUM(CASE WHEN spent.slot IS NOT NULL THEN 1 ELSE 0 END) AS quota FROM event_offline_admission_spends spent JOIN grants ON grants.id=spent.grant_id GROUP BY spent.grant_id)
 SELECT COUNT(*) AS knownGrants,COALESCE(SUM(g.closed_at IS NULL),0) AS unclosedGrants,COUNT(DISTINCT CASE WHEN g.closed_at IS NULL THEN g.device_id END) AS unclosedDevices,COALESCE(SUM(g.closed_at IS NULL AND g.revoked_at IS NOT NULL),0) AS revokedUnclosedGrants,COALESCE(SUM(g.closed_at IS NULL AND g.expires_at<=?),0) AS expiredUnclosedGrants,COALESCE(SUM(spends.reconciled),0) AS reconciledAdmissions,COALESCE(SUM(CASE WHEN g.closed_at IS NULL THEN MAX(0,g.quantity-COALESCE(spends.quota,0)) ELSE 0 END),0) AS heldUnspentSlots FROM grants g LEFT JOIN spends ON spends.grant_id=g.id`,
    [eventId, context.occurrenceId, context.occurrenceId, context.dayDate, context.dayDate, generatedAt],
  );
  const received = await first<{ lastReceivedAt: string | null }>(
    db,
    `SELECT MAX(received_at) AS lastReceivedAt FROM (SELECT a.created_at AS received_at FROM event_scan_attempts a WHERE ${attendanceScopeSql("a", context)} AND a.user_id IS NOT NULL AND a.action<>'lead' AND (? IS NULL OR ?='physical') UNION ALL SELECT imported.received_at FROM event_attendance_observations o JOIN event_attendance_import_provenance provenance ON provenance.observation_id=o.id JOIN event_attendance_imports imported ON imported.id=provenance.import_id WHERE ${attendanceScopeSql("o", context)} AND (? IS NULL OR o.attendance_mode=?))`,
    [
      ...attendanceScopeBindings(context),
      context.attendanceMode,
      context.attendanceMode,
      ...attendanceScopeBindings(context),
      context.attendanceMode,
      context.attendanceMode,
    ],
  );
  const coverage = await first<{ missingObservations: number; missingAttempts: number; capturedTimeZones: number }>(
    db,
    `SELECT
    (SELECT COUNT(*) FROM event_attendance_observations o WHERE ${attendanceBaseScopeSql("o")} AND (? IS NULL OR o.attendance_mode=?) AND NOT (${attendanceCapturedSql("o")})) AS missingObservations,
    (SELECT COUNT(*) FROM event_scan_attempts a WHERE ${attendanceBaseScopeSql("a")} AND a.user_id IS NOT NULL AND a.action<>'lead' AND (? IS NULL OR ?='physical') AND NOT (${attendanceCapturedSql("a")})) AS missingAttempts,
    (SELECT COUNT(DISTINCT time_zone) FROM (SELECT o.capture_time_zone AS time_zone FROM event_attendance_observations o WHERE ${attendanceScopeSql("o", context)} AND (? IS NULL OR o.attendance_mode=?) AND ${attendanceCapturedSql("o")} UNION SELECT a.capture_time_zone AS time_zone FROM event_scan_attempts a WHERE ${attendanceScopeSql("a", context)} AND a.user_id IS NOT NULL AND a.action<>'lead' AND (? IS NULL OR ?='physical') AND ${attendanceCapturedSql("a")})) AS capturedTimeZones`,
    [
      ...attendanceBaseScopeBindings(context),
      context.attendanceMode,
      context.attendanceMode,
      ...attendanceBaseScopeBindings(context),
      context.attendanceMode,
      context.attendanceMode,
      ...attendanceScopeBindings(context),
      context.attendanceMode,
      context.attendanceMode,
      ...attendanceScopeBindings(context),
      context.attendanceMode,
      context.attendanceMode,
    ],
  );
  const reconciliation = await eventScannerReconciliation(db, eventId);
  return attendanceSummarySchema.parse({
    ...context,
    generatedAt,
    currentIntent: {
      timeZone: context.timeZone,
      startAt: context.intentStartAt,
      endAt: context.intentEndAt,
      dayIntervalAvailable: context.dayDate === null || context.intentStartAt !== null,
    },
    classification: {
      ...coverage,
      basis: "captured_calendar_date",
      mixedTimeZones: (coverage?.capturedTimeZones ?? 0) > 1,
      dayFilterExcludesMissing: context.dayDate !== null,
      missingScope: "event_occurrence_mode_without_day",
    },
    contactRetention: await readEventContactRetention(db, eventId),
    observed,
    attempts,
    sync: {
      ...sync,
      deviceBacklog: reconciliation.deviceBacklog,
      scannerReconciliation: reconciliation,
      completeness: "not_established",
      lastReceivedAt: received?.lastReceivedAt ?? null,
    },
    evidence: {
      clockVerification: "unverified",
      providerVerification: "source_assertion",
      presenceDuration: "not_established",
      checkoutCaptureSupported: true,
      entryCounting: "person_target_mode_browser_observations",
    },
  });
}

/** A retired source is served only from exact preserved scope populations. */
export async function eventAttendanceSummary(db: DatabaseLike, eventId: string, raw: unknown) {
  const query = attendanceScopeQuerySchema.parse(raw);
  const retained = await retainedAttendanceScope(db, eventId, query);
  if (retained) return retained.summary;
  return materializeEventAttendanceSummary(db, eventId, query);
}
