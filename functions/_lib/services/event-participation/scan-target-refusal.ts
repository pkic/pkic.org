import type { ScannerAdmissionDecision } from "../../../../assets/shared/schemas/event-scanner-admission";
import { scannerAdmissionDecisionSql } from "./scanner-admission-decision";
import type { EventScanRequest } from "../../../../assets/shared/schemas/event-participation-scanning";
import { eventScanResponseSchema } from "../../../../assets/shared/schemas/event-participation-scanning";
import { first } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { AppError } from "../../errors";
import { nowIso } from "../../utils/time";
import { hashBadgeCredential } from "./badge-hash";
import { scanCaptureDecision } from "./scan-capture-decision";

/** Invalid targets cannot allocate admission, but a recognized badge still has an immutable attempt. */
export async function recordScanTargetRefusal(
  db: DatabaseLike,
  eventId: string,
  scan: EventScanRequest,
  requestHash: string,
  reason: "wrong_location" | "verification_required",
) {
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
      checkoutRecorded: false,
    });
  const capture = await scanCaptureDecision(db, eventId, scan);
  const id = crypto.randomUUID();
  const statements = [
    db
      .prepare(
        `INSERT INTO event_scan_attempts
    (id,event_id,occurrence_id,badge_id,user_id,operator_user_id,device_id,operation_id,request_hash,outcome,reason,action,observed_at,created_at,capture_day_date,capture_time_zone,capture_publication_revision,capture_context_source)
    SELECT ?,badge.event_id,(SELECT target.id FROM event_agenda_occurrences target WHERE target.id=? AND target.event_id=badge.event_id),badge.id,badge.user_id,?,?,?,?,
    CASE WHEN badge.revoked_at IS NOT NULL OR (badge.expires_at IS NOT NULL AND badge.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')) THEN 'denied' ELSE ? END,
    CASE WHEN badge.revoked_at IS NOT NULL THEN 'revoked_badge' WHEN badge.expires_at IS NOT NULL AND badge.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') THEN 'expired_badge' ELSE ? END,?,?,?,?,?,?,?
    FROM event_badge_credentials badge WHERE badge.id=? AND badge.event_id=? ON CONFLICT(operation_id) DO NOTHING`,
      )
      .bind(
        id,
        scan.occurrenceId,
        scan.operatorUserId,
        scan.deviceId,
        scan.operationId,
        requestHash,
        "warning",
        reason,
        scan.action,
        scan.observedAt,
        nowIso(),
        ...capture.values,
        badge.id,
        eventId,
      ),
  ];
  if (scan.action === "admission" || scan.action === "exception")
    statements.push(
      db
        .prepare(
          `UPDATE event_scan_attempts SET admission_decision=${scannerAdmissionDecisionSql(scan.action, "0=1")}
      WHERE id=? AND event_id=? AND operation_id=? AND request_hash=? AND admission_decision IS NULL`,
        )
        .bind(id, eventId, scan.operationId, requestHash),
    );
  await db.batch(statements);
  const attempt = await first<{
    request_hash: string;
    outcome: string;
    reason: string;
    admissionDecision: ScannerAdmissionDecision | null;
  }>(
    db,
    "SELECT request_hash,outcome,reason,admission_decision AS admissionDecision FROM event_scan_attempts WHERE operation_id=? AND event_id=? AND operator_user_id=?",
    [scan.operationId, eventId, scan.operatorUserId],
  );
  if (!attempt || attempt.request_hash !== requestHash)
    throw new AppError(409, "SCAN_OPERATION_REUSED", "Use a new operation ID for a different scan.");
  return eventScanResponseSchema.parse({
    operationId: scan.operationId,
    outcome: attempt.outcome,
    reason: attempt.reason,
    recorded: true,
    attendanceRecorded: false,
    admissionRecorded: attempt.admissionDecision !== null,
    admissionDecision: attempt.admissionDecision,
    checkoutRecorded: false,
  });
}
