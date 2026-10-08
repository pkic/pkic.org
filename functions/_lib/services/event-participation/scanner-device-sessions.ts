import { z } from "zod";
import {
  scannerDeviceSessionEnrollmentSchema,
  scannerDeviceSessionEnrollmentResponseSchema,
  scannerDeviceSessionClosingSchema,
  scannerDeviceSessionStatusSchema,
} from "../../../../assets/shared/schemas/event-scanner-devices";
import { first } from "../../db/queries";
import { prepareScannerLifecycleGuard, isScannerLifecycleGuardFailure } from "./scanner-lifecycle-guard";
import type { DatabaseLike } from "../../types";
import { AppError } from "../../errors";
import { nowIso } from "../../utils/time";
import { scannerCaptureOpenSql } from "./scanner-upload-receipts";
import { guardDatabaseBatches } from "../../db/guarded-database";
import { prepareAuthorizationGuard } from "../../db/authorization-guard";

/** Sponsor-scoped enrollment and closure retain the active sponsorship boundary in every atomic command. */
export function guardScannerSponsorDatabase(db: DatabaseLike, eventId: string, sponsorId?: string): DatabaseLike {
  if (!sponsorId) return db;
  return guardDatabaseBatches(db, async (statements) => {
    const [, ...results] = await db.batch([
      prepareAuthorizationGuard(db, {
        sql: "SELECT 1 FROM sponsorships WHERE id=? AND event_id=? AND sponsor_type='event' AND pipeline_stage='active'",
        bindings: [sponsorId, eventId],
      }),
      ...statements,
    ]);
    return results;
  });
}

const enrollmentColumns =
  "id AS epochId,event_id AS eventId,operator_user_id AS operatorUserId,device_id AS deviceId,opened_at AS openedAt";
export async function enrollScannerDevice(
  db: DatabaseLike,
  eventId: string,
  operatorUserId: string,
  input: z.infer<typeof scannerDeviceSessionEnrollmentSchema>,
) {
  const existing = await first(
    db,
    `SELECT ${enrollmentColumns} FROM event_scanner_device_sessions WHERE enrollment_operation_id=?`,
    [input.operationId],
  );
  if (existing) {
    const enrollment = scannerDeviceSessionEnrollmentResponseSchema.parse(existing);
    if (
      enrollment.eventId !== eventId ||
      enrollment.operatorUserId !== operatorUserId ||
      enrollment.deviceId !== input.deviceId
    )
      throw new AppError(409, "SCANNER_ENROLLMENT_REUSED", "Use a new preparation operation for this scanner.");
    const guard = prepareScannerLifecycleGuard(db, {
      sql: `SELECT 1 WHERE ${scannerCaptureOpenSql}`,
      bindings: [eventId],
    });
    try {
      await db.batch([guard.statement, guard.cleanup]);
    } catch (error) {
      if (isScannerLifecycleGuardFailure(error))
        throw new AppError(409, "EVENT_CAPTURE_CLOSED", "Scanner preparation for this event is closed.");
      throw error;
    }
    return enrollment;
  }
  const epochId = crypto.randomUUID();
  const openedAt = nowIso();
  const guard = prepareScannerLifecycleGuard(db, {
    sql: `SELECT 1 WHERE ${scannerCaptureOpenSql}`,
    bindings: [eventId],
  });
  try {
    await db.batch([
      guard.statement,
      db
        .prepare(
          "INSERT INTO event_scanner_device_sessions(id,event_id,operator_user_id,device_id,enrollment_operation_id,opened_at) VALUES(?,?,?,?,?,?) ON CONFLICT(enrollment_operation_id) DO NOTHING",
        )
        .bind(epochId, eventId, operatorUserId, input.deviceId, input.operationId, openedAt),
      guard.cleanup,
    ]);
  } catch (error) {
    if (isScannerLifecycleGuardFailure(error))
      throw new AppError(409, "EVENT_CAPTURE_CLOSED", "Scanner preparation for this event is closed.");
    throw error;
  }
  const enrollment = scannerDeviceSessionEnrollmentResponseSchema.parse(
    await first(db, `SELECT ${enrollmentColumns} FROM event_scanner_device_sessions WHERE enrollment_operation_id=?`, [
      input.operationId,
    ]),
  );
  if (
    enrollment.eventId !== eventId ||
    enrollment.operatorUserId !== operatorUserId ||
    enrollment.deviceId !== input.deviceId
  )
    throw new AppError(409, "SCANNER_ENROLLMENT_REUSED", "Use a new preparation operation for this scanner.");
  return enrollment;
}

export async function scannerDeviceSessionStatus(
  db: DatabaseLike,
  eventId: string,
  operatorUserId: string,
  epochId: string,
) {
  const row = await first(
    db,
    `SELECT session.id AS epochId,session.device_id AS deviceId,
    session.enrollment_operation_id AS enrollmentOperationId,session.opened_at AS openedAt,
    session.high_water_sequence AS highWaterSequence,
    (SELECT COUNT(*) FROM event_scanner_upload_receipts receipt WHERE receipt.epoch_id=session.id) AS receivedCount,
    CASE WHEN session.high_water_sequence IS NULL THEN NULL ELSE session.high_water_sequence-(SELECT COUNT(*) FROM event_scanner_upload_receipts receipt WHERE receipt.epoch_id=session.id) END AS missingCount,
    session.closing_declared_at AS closingDeclaredAt,session.closing_operation_id AS closingOperationId,session.closed_at AS closedAt
    FROM event_scanner_device_sessions session WHERE session.id=? AND session.event_id=? AND session.operator_user_id=?`,
    [epochId, eventId, operatorUserId],
  );
  if (!row) throw new AppError(404, "SCANNER_SESSION_NOT_FOUND", "Scanner session not found for this operator.");
  return scannerDeviceSessionStatusSchema.parse(row);
}

/** Declaration freezes issuance; missing sequences can still upload before the exact barrier closes. */
export async function closeScannerDeviceSession(
  db: DatabaseLike,
  eventId: string,
  operatorUserId: string,
  epochId: string,
  input: z.infer<typeof scannerDeviceSessionClosingSchema>,
) {
  await scannerDeviceSessionStatus(db, eventId, operatorUserId, epochId);
  const now = nowIso();
  const guard = prepareScannerLifecycleGuard(db, {
    sql: `SELECT 1 FROM event_scanner_device_sessions session WHERE session.id=? AND session.event_id=? AND session.operator_user_id=?
         AND (session.closing_operation_id IS NULL OR (session.closing_operation_id=? AND session.high_water_sequence=?))
         AND NOT EXISTS(SELECT 1 FROM event_scanner_upload_receipts receipt WHERE receipt.epoch_id=session.id AND receipt.sequence>?)`,
    bindings: [epochId, eventId, operatorUserId, input.operationId, input.highWaterSequence, input.highWaterSequence],
  });
  try {
    await db.batch([
      guard.statement,
      db
        .prepare(
          "UPDATE event_scanner_device_sessions SET high_water_sequence=?,closing_operation_id=?,closing_declared_at=? WHERE id=? AND event_id=? AND operator_user_id=? AND closing_operation_id IS NULL",
        )
        .bind(input.highWaterSequence, input.operationId, now, epochId, eventId, operatorUserId),
      db
        .prepare(
          `UPDATE event_scanner_device_sessions SET closed_at=? WHERE id=? AND event_id=? AND operator_user_id=? AND closing_operation_id=? AND high_water_sequence=? AND closed_at IS NULL
        AND (SELECT COUNT(*) FROM event_scanner_upload_receipts receipt WHERE receipt.epoch_id=event_scanner_device_sessions.id)=high_water_sequence
        AND NOT EXISTS(SELECT 1 FROM event_scanner_upload_receipts receipt WHERE receipt.epoch_id=event_scanner_device_sessions.id AND receipt.sequence>high_water_sequence)`,
        )
        .bind(now, epochId, eventId, operatorUserId, input.operationId, input.highWaterSequence),
      guard.cleanup,
    ]);
  } catch (error) {
    if (isScannerLifecycleGuardFailure(error))
      throw new AppError(
        409,
        "SCANNER_CLOSING_CONFLICT",
        "The closing declaration does not match this scanner's issued operations.",
      );
    throw error;
  }
  return scannerDeviceSessionStatus(db, eventId, operatorUserId, epochId);
}
