import { readScannerAttemptBasis } from "./scanner-attempt-basis";
import { prepareAttemptCapturedValue } from "./scan-attempt-capture";
import { recordScanTargetRefusal } from "./scan-target-refusal";
import { hashBadgeCredential } from "./badge-hash";
import type { EventScanRequest } from "../../../../assets/shared/schemas/event-participation-scanning";
import {
  eventScanResponseSchema,
  eventScanRequestForRoomsSchema,
} from "../../../../assets/shared/schemas/event-participation-scanning";
import type { DatabaseLike } from "../../types";
import { batchFirst } from "../../db/pagination";
import { AppError } from "../../errors";
import { nowIso } from "../../utils/time";
import { resolvePhysicalSessionRoom } from "./session-room";

type Receipt = { request_hash: string; outcome: string; reason: string; attendanceRecorded: number };
/** Departure evidence never allocates admission, spends offline rights, or changes capacity. */
export async function recordCheckout(db: DatabaseLike, eventId: string, scan: EventScanRequest) {
  const requestHash = await hashBadgeCredential(JSON.stringify(scan));
  const receiptSql = `SELECT a.request_hash,a.outcome,a.reason,EXISTS(SELECT 1 FROM event_attendance_observations observation WHERE observation.attempt_id=a.id) AS attendanceRecorded FROM event_scan_attempts a WHERE a.operation_id=? AND a.event_id=? AND a.operator_user_id=?`;
  const values = [scan.operationId, eventId, scan.operatorUserId];
  const response = (receipt: Receipt) => {
    if (receipt.request_hash !== requestHash)
      throw new AppError(409, "SCAN_OPERATION_REUSED", "Use a new operation ID for a different scan.");
    return eventScanResponseSchema.parse({
      operationId: scan.operationId,
      outcome: receipt.outcome,
      reason: receipt.reason,
      recorded: true,
      attendanceRecorded: false,
      checkoutRecorded: Boolean(receipt.attendanceRecorded),
      admissionRecorded: false,
    });
  };
  const {
    replay,
    location,
    badge,
    capture: decodeCapture,
  } = await readScannerAttemptBasis<Receipt>(db, eventId, scan, db.prepare(receiptSql).bind(...values));
  if (replay) return response(replay);
  if (scan.occurrenceId && !location)
    return recordScanTargetRefusal(db, eventId, scan, requestHash, "verification_required", badge?.id ?? null);
  if (!scan.occurrenceId && scan.roomId)
    return recordScanTargetRefusal(db, eventId, scan, requestHash, "wrong_location", badge?.id ?? null);
  if (
    location &&
    !eventScanRequestForRoomsSchema([
      ...(location.room_id ? [location.room_id] : []),
      ...JSON.parse(location.additional_room_ids_json),
    ]).safeParse(scan).success
  )
    return recordScanTargetRefusal(db, eventId, scan, requestHash, "wrong_location", badge?.id ?? null);
  const roomId = location ? resolvePhysicalSessionRoom(location, scan.roomId) : null;
  if (!badge)
    return eventScanResponseSchema.parse({
      operationId: scan.operationId,
      outcome: "unknown",
      reason: "unknown_credential",
      recorded: false,
      attendanceRecorded: false,
      checkoutRecorded: false,
      admissionRecorded: false,
    });
  const capture = decodeCapture();
  const id = crypto.randomUUID();
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO event_scan_attempts(id,event_id,occurrence_id,badge_id,user_id,operator_user_id,device_id,operation_id,request_hash,room_id,outcome,reason,action,observed_at,created_at,capture_day_date,capture_time_zone,capture_publication_revision,capture_context_source)
      SELECT ?,event_id,?,id,user_id,?,?,?,?,?,CASE WHEN NOT (${capture.sql}) THEN 'unverified' WHEN revoked_at IS NOT NULL OR (expires_at IS NOT NULL AND expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')) THEN 'denied' ELSE 'eligible' END,CASE WHEN NOT (${capture.sql}) THEN 'verification_required' WHEN revoked_at IS NOT NULL THEN 'revoked_badge' WHEN expires_at IS NOT NULL AND expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') THEN 'expired_badge' ELSE 'eligible' END,'checkout',?,?,?,?,?,? FROM event_badge_credentials WHERE id=? AND event_id=? ON CONFLICT(operation_id) DO NOTHING`,
      )
      .bind(
        id,
        scan.occurrenceId,
        scan.operatorUserId,
        scan.deviceId,
        scan.operationId,
        requestHash,
        roomId,
        ...capture.bindings,
        ...capture.bindings,
        scan.observedAt,
        nowIso(),
        ...capture.values,
        badge.id,
        eventId,
      ),
    db
      .prepare(
        `INSERT INTO event_attendance_observations(id,attempt_id,event_id,occurrence_id,user_id,attendance_mode,observed_at,room_id,capture_day_date,capture_time_zone,capture_publication_revision,capture_context_source) SELECT ?,id,event_id,occurrence_id,user_id,'physical',observed_at,room_id,capture_day_date,capture_time_zone,capture_publication_revision,capture_context_source FROM event_scan_attempts WHERE id=? AND outcome='eligible'`,
      )
      .bind(crypto.randomUUID(), id),
    prepareAttemptCapturedValue(db, eventId, scan, requestHash),
    db.prepare(receiptSql).bind(...values),
  ]);
  const committed = batchFirst<Receipt>(results[results.length - 1]);
  if (!committed) throw new AppError(409, "SCAN_OPERATION_REUSED", "Use a new operation ID for a different scan.");
  return response(committed);
}
