import {
  eventScanResponseSchema,
  type EventScanRequest,
  type EventScanResponse,
} from "../../../../assets/shared/schemas/event-participation-scanning";
import { first } from "../../db/queries";
import { prepareScannerLifecycleGuard, isScannerLifecycleGuardFailure } from "./scanner-lifecycle-guard";
import type { DatabaseLike, StatementLike } from "../../types";
import { AppError } from "../../errors";
import { nowIso } from "../../utils/time";
import { hashBadgeCredential } from "./badge-hash";

export const scannerCaptureOpenSql = `NOT EXISTS(SELECT 1 FROM event_evidence_retention_state retired WHERE retired.event_id=? AND (retired.capture_closed_at IS NOT NULL OR retired.active_run_id IS NOT NULL))`;

/** A received business refusal resolves upload transport without asserting admission or presence. */
export async function receiveScannerUpload(
  db: DatabaseLike,
  eventId: string,
  scan: EventScanRequest,
  capture: (guarded: DatabaseLike) => Promise<unknown>,
): Promise<EventScanResponse> {
  const session = scan.scannerSession;
  if (!session)
    throw new AppError(409, "SCANNER_ENROLLMENT_REQUIRED", "Prepare this scanner online before uploading scans.");
  const requestHash = await hashBadgeCredential(JSON.stringify(scan));
  const readReceipt = async () => {
    const row = await first<{
      request_hash: string;
      response_json: string;
      sequence: number;
      operation_id: string;
      epoch_id: string;
    }>(
      db,
      `SELECT receipt.request_hash,receipt.response_json,receipt.sequence,receipt.operation_id,receipt.epoch_id FROM event_scanner_upload_receipts receipt JOIN event_scanner_device_sessions session ON session.id=receipt.epoch_id
       WHERE session.event_id=? AND session.operator_user_id=? AND session.device_id=? AND (receipt.operation_id=? OR (receipt.epoch_id=? AND receipt.sequence=?))`,
      [eventId, scan.operatorUserId, scan.deviceId, scan.operationId, session.epochId, session.sequence],
    );
    if (!row) return null;
    if (
      row.request_hash !== requestHash ||
      row.sequence !== session.sequence ||
      row.operation_id !== scan.operationId ||
      row.epoch_id !== session.epochId
    )
      throw new AppError(
        409,
        "SCANNER_RECEIPT_CONFLICT",
        "This scanner sequence or operation already belongs to another capture.",
      );
    return eventScanResponseSchema.parse(JSON.parse(row.response_json));
  };
  const replay = await readReceipt();
  if (replay) return replay;
  const receivedAt = nowIso();
  let committed = false;
  const execute = async (statements: StatementLike[]) => {
    const guard = prepareScannerLifecycleGuard(db, {
      sql: `SELECT 1 FROM event_scanner_device_sessions session WHERE session.id=? AND session.event_id=? AND session.operator_user_id=? AND session.device_id=? AND session.closed_at IS NULL AND (session.high_water_sequence IS NULL OR ?>=1 AND ?<=session.high_water_sequence) AND ${scannerCaptureOpenSql}`,
      bindings: [
        session.epochId,
        eventId,
        scan.operatorUserId,
        scan.deviceId,
        session.sequence,
        session.sequence,
        eventId,
      ],
    });
    // Derive the immutable response after all business statements, inside their same transaction.
    const receipt = db
      .prepare(
        `INSERT INTO event_scanner_upload_receipts(epoch_id,sequence,operation_id,request_hash,response_json,received_at)
      SELECT ?,?,?,?,json_object('operationId',?,'outcome',COALESCE(attempt.outcome,'unknown'),'reason',COALESCE(attempt.reason,'unknown_credential'),
      'recorded',json(CASE WHEN attempt.id IS NULL THEN 'false' ELSE 'true' END),
      'attendanceRecorded',json(CASE WHEN attempt.action<>'checkout' AND EXISTS(SELECT 1 FROM event_attendance_observations observed WHERE observed.attempt_id=attempt.id) THEN 'true' ELSE 'false' END),
      'checkoutRecorded',json(CASE WHEN attempt.action='checkout' AND EXISTS(SELECT 1 FROM event_attendance_observations observed WHERE observed.attempt_id=attempt.id) THEN 'true' ELSE 'false' END),
      'admissionRecorded',json(CASE WHEN attempt.admission_decision IS NOT NULL THEN 'true' ELSE 'false' END),
      'admissionDecision',attempt.admission_decision,
      'scannerReceipt',json_object('epochId',?,'sequence',?,'operationId',?,'receivedAt',?)),?
      FROM (SELECT 1) singleton LEFT JOIN event_scan_attempts attempt ON attempt.operation_id=? AND attempt.event_id=? AND attempt.operator_user_id=?`,
      )
      .bind(
        session.epochId,
        session.sequence,
        scan.operationId,
        requestHash,
        scan.operationId,
        session.epochId,
        session.sequence,
        scan.operationId,
        receivedAt,
        receivedAt,
        scan.operationId,
        eventId,
        scan.operatorUserId,
      );
    const results = await db.batch([
      guard.statement,
      ...statements,
      receipt,
      db
        .prepare("UPDATE event_scanner_device_sessions SET last_receipt_at=? WHERE id=?")
        .bind(receivedAt, session.epochId),
      guard.cleanup,
    ]);
    committed = true;
    return results.slice(1, 1 + statements.length);
  };
  const guarded: DatabaseLike = { prepare: (query) => db.prepare(query), batch: execute };
  try {
    await capture(guarded);
    // Unknown credentials and business replays can legitimately have no business mutation batch.
    if (!committed) await execute([]);
  } catch (error) {
    if (
      isScannerLifecycleGuardFailure(error) ||
      (error instanceof Error &&
        (error.message.includes("SCANNER_RECEIPT_CONFLICT") ||
          error.message.includes("SCANNER_DEVICE_SESSION_CLOSED") ||
          error.message.includes("EVENT_EVIDENCE_CAPTURE_CLOSED")))
    ) {
      const racedReplay = await readReceipt();
      if (racedReplay) return racedReplay;
      if (error instanceof Error && error.message.includes("SCANNER_RECEIPT_CONFLICT"))
        throw new AppError(
          409,
          "SCANNER_RECEIPT_CONFLICT",
          "This scanner sequence or operation already belongs to another capture.",
        );
      throw new AppError(
        409,
        "SCANNER_SESSION_CLOSED",
        "This scanner session or event capture is closed. Keep the pending scans for recovery.",
      );
    }
    throw error;
  }
  const response = await readReceipt();
  if (!response) throw new Error("Scanner upload receipt did not commit");
  return response;
}
