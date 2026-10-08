import { scannerAdmissionDecisionSql } from "./scanner-admission-decision";
import { recordScanTargetRefusal } from "./scan-target-refusal";
import { scanCaptureDecision } from "./scan-capture-decision";
import { hashBadgeCredential } from "./badge-hash";
import { recordCheckout } from "./checkout";
import { resolvePhysicalSessionRoom } from "./session-room";
import {
  eventScanRequestSchema,
  eventScanRequestForRoomsSchema,
  eventScanResponseSchema,
  type EventScanRequest,
  type EventScanResponse,
} from "../../../../assets/shared/schemas/event-participation-scanning";
import { first } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { publishedSessionsSql } from "./published-schedule";
import { AppError } from "../../errors";
import { nowIso } from "../../utils/time";
import { registrationDayAttendanceSql, sessionAccessEligibleSql } from "./session-access";

export { hashBadgeCredential } from "./badge-hash";
export { issueBadge, revokeBadge } from "./badge-lifecycle";

type ScannerAuthority = { operatorUserId: string; canScan: boolean; canAdmitExceptions: boolean };
type AttemptRow = {
  request_hash: string;
  outcome: EventScanResponse["outcome"];
  reason: EventScanResponse["reason"];
  attendanceRecorded: number;
  admissionDecision: EventScanResponse["admissionDecision"];
};

/** Scans report registration information and record evidence; they never allocate entry or spend quota. */
export async function recordScan(
  db: DatabaseLike,
  eventId: string,
  authority: ScannerAuthority,
  raw: EventScanRequest,
): Promise<EventScanResponse> {
  if (!authority.canScan) throw new AppError(403, "SCAN_PERMISSION_REQUIRED", "Scanning permission required.");
  const scan = eventScanRequestSchema.parse(raw);
  if (scan.operatorUserId !== authority.operatorUserId)
    throw new AppError(403, "SCAN_OPERATOR_CHANGED", "Sign in as the original scanner operator.");
  if (scan.action === "lead")
    throw new AppError(403, "LEAD_SCOPE_REQUIRED", "Use the sponsor-scoped lead capture service.");
  if (scan.action === "exception" && !authority.canAdmitExceptions)
    throw new AppError(403, "EXCEPTION_PERMISSION_REQUIRED", "Exception permission required.");
  if (scan.action === "checkout") return recordCheckout(db, eventId, scan);
  const requestHash = await hashBadgeCredential(JSON.stringify(scan));
  const receiptSql = `SELECT a.request_hash,a.outcome,a.reason,a.admission_decision AS admissionDecision,
    EXISTS(SELECT 1 FROM event_attendance_observations o WHERE o.attempt_id=a.id) AS attendanceRecorded
    FROM event_scan_attempts a WHERE a.operation_id=? AND a.event_id=? AND a.operator_user_id=?`;
  const receiptBindings = [scan.operationId, eventId, authority.operatorUserId];
  const response = (receipt: AttemptRow) => {
    if (receipt.request_hash !== requestHash)
      throw new AppError(409, "SCAN_OPERATION_REUSED", "Use a new operation ID for a different scan.");
    return eventScanResponseSchema.parse({
      operationId: scan.operationId,
      outcome: receipt.outcome,
      reason: receipt.reason,
      recorded: true,
      attendanceRecorded: Boolean(receipt.attendanceRecorded),
      admissionRecorded: receipt.admissionDecision !== null,
      admissionDecision: receipt.admissionDecision,
    });
  };
  const replay = await first<AttemptRow>(db, receiptSql, receiptBindings);
  if (replay) return response(replay);
  const location = scan.occurrenceId
    ? await first<{ room_id: string | null; additional_room_ids_json: string }>(
        db,
        `SELECT room_id,additional_room_ids_json FROM (${publishedSessionsSql}) WHERE id=? AND event_id=?`,
        [scan.occurrenceId, eventId],
      )
    : null;
  if (scan.occurrenceId && !location)
    return recordScanTargetRefusal(db, eventId, scan, requestHash, "verification_required");
  const wrongLocation = Boolean(
    (!scan.occurrenceId && scan.roomId) ||
    (location &&
      !eventScanRequestForRoomsSchema([
        ...(location.room_id ? [location.room_id] : []),
        ...JSON.parse(location.additional_room_ids_json),
      ]).safeParse(scan).success),
  );
  const roomId = !wrongLocation && location ? resolvePhysicalSessionRoom(location, scan.roomId) : null;
  const badge = await first<{ id: string }>(
    db,
    "SELECT id FROM event_badge_credentials WHERE event_id=? AND credential_hash=?",
    [eventId, await hashBadgeCredential(scan.badgeId)],
  );
  if (!badge)
    return eventScanResponseSchema.parse({
      operationId: scan.operationId,
      outcome: "unknown",
      reason: "unknown_credential",
      recorded: false,
      attendanceRecorded: false,
      admissionRecorded: false,
      admissionDecision: null,
    });
  // Historical grant metadata is optional; normal evidence does not depend on grant availability.
  const capture = await scanCaptureDecision(db, eventId, { ...scan, offlineRight: undefined }, true);
  const id = crypto.randomUUID();
  const now = nowIso();
  const registration = "COALESCE(reg.status,'')<>'registered'";
  const missingBooking = scan.occurrenceId
    ? `NOT EXISTS(SELECT 1 FROM (${publishedSessionsSql}) session WHERE session.id=target.occurrence_id AND session.event_id=badge.event_id AND ${sessionAccessEligibleSql("session", "badge.user_id", "'physical'", "target.room_id")})`
    : "0=1";
  const physicalDay = `${registrationDayAttendanceSql("reg", "target.day_date")}<>'in_person'`;
  const outcomeSql = `CASE WHEN badge.revoked_at IS NOT NULL OR (badge.expires_at IS NOT NULL AND badge.expires_at<=?) THEN 'denied' WHEN ${wrongLocation ? "1=1" : "0=1"} THEN 'warning' WHEN ${registration} OR (${missingBooking}) OR ${physicalDay} THEN 'warning' WHEN NOT (${capture.sql}) THEN 'unverified' ELSE 'eligible' END`;
  const reasonSql = `CASE WHEN badge.revoked_at IS NOT NULL THEN 'revoked_badge' WHEN badge.expires_at IS NOT NULL AND badge.expires_at<=? THEN 'expired_badge' WHEN ${wrongLocation ? "1=1" : "0=1"} THEN 'wrong_location' WHEN reg.status='cancelled' THEN 'canceled_registration' WHEN ${registration} OR (${missingBooking}) THEN 'missing_registration' WHEN ${physicalDay} THEN 'wrong_attendance_mode' WHEN NOT (${capture.sql}) THEN 'verification_required' ELSE 'eligible' END`;
  const statements = [
    db
      .prepare(
        `WITH target AS(SELECT ? AS occurrence_id,? AS room_id,? AS day_date) INSERT INTO event_scan_attempts
    (id,event_id,occurrence_id,badge_id,user_id,operator_user_id,device_id,operation_id,request_hash,room_id,outcome,reason,exception_reason,action,observed_at,created_at,capture_day_date,capture_time_zone,capture_publication_revision,capture_context_source)
    SELECT ?,badge.event_id,?,badge.id,badge.user_id,?,?,?,?,?,${outcomeSql},${reasonSql},?,?,?,?,?,?,?,?
    FROM event_badge_credentials badge CROSS JOIN target LEFT JOIN registrations reg ON reg.event_id=badge.event_id AND reg.user_id=badge.user_id
    WHERE badge.id=? AND badge.event_id=? ON CONFLICT(operation_id) DO NOTHING`,
      )
      .bind(
        scan.occurrenceId,
        roomId,
        capture.context.state === "captured" ? capture.context.dayDate : null,
        id,
        scan.occurrenceId,
        authority.operatorUserId,
        scan.deviceId,
        scan.operationId,
        requestHash,
        roomId,
        scan.observedAt,
        ...capture.bindings,
        scan.observedAt,
        ...capture.bindings,
        scan.exceptionReason ?? null,
        scan.action,
        scan.observedAt,
        now,
        ...capture.values,
        badge.id,
        eventId,
      ),
  ];
  if (scan.action === "admission" || scan.action === "exception")
    statements.push(
      db
        .prepare(
          `UPDATE event_scan_attempts SET admission_decision=${scannerAdmissionDecisionSql(scan.action, capture.sql)}
        WHERE id=? AND event_id=? AND operation_id=? AND request_hash=? AND admission_decision IS NULL`,
        )
        .bind(...capture.bindings, id, eventId, scan.operationId, requestHash),
    );
  if (scan.action === "attendance" || (scan.action === "exception" && scan.recordAttendance))
    statements.push(
      db
        .prepare(
          `INSERT INTO event_attendance_observations
      (id,attempt_id,event_id,occurrence_id,user_id,attendance_mode,observed_at,room_id,capture_day_date,capture_time_zone,capture_publication_revision,capture_context_source)
      SELECT ?,id,event_id,occurrence_id,user_id,'physical',observed_at,room_id,capture_day_date,capture_time_zone,capture_publication_revision,capture_context_source FROM event_scan_attempts WHERE id=? AND reason NOT IN ('revoked_badge','expired_badge')`,
        )
        .bind(crypto.randomUUID(), id),
    );
  await db.batch(statements);
  const committed = await first<AttemptRow>(db, receiptSql, receiptBindings);
  if (!committed) throw new AppError(409, "SCAN_OPERATION_REUSED", "Use a new operation ID for a different scan.");
  return response(committed);
}
