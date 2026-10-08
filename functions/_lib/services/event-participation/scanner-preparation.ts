import { guardDatabaseBatches } from "../../db/guarded-database";
import type { DatabaseLike } from "../../types";
import { AppError } from "../../errors";
import { prepareScannerLifecycleGuard, isScannerLifecycleGuardFailure } from "./scanner-lifecycle-guard";
import { scannerCaptureOpenSql } from "./scanner-upload-receipts";
import { offlineEligibility } from "./offline-eligibility";
import {
  enrolledOfflineEligibilityResponseSchema,
  type enrolledOfflineEligibilityQuerySchema,
} from "../../../../assets/shared/schemas/event-offline-eligibility";
import type { z } from "zod";

/** Every preparation page rechecks its open epoch, including cached clients and quota activation. */
export function guardScannerPreparationDatabase(
  db: DatabaseLike,
  eventId: string,
  operatorUserId: string,
  deviceId: string,
  epochId: string,
  grantId?: string,
): DatabaseLike {
  return guardDatabaseBatches(db, async (statements) => {
    const guard = prepareScannerLifecycleGuard(db, {
      sql: `SELECT 1 FROM event_scanner_device_sessions session WHERE session.id=? AND session.event_id=? AND session.operator_user_id=? AND session.device_id=? AND session.closed_at IS NULL AND session.high_water_sequence IS NULL AND ${scannerCaptureOpenSql}
        AND (? IS NULL OR EXISTS(SELECT 1 FROM event_offline_admission_grants grant_record WHERE grant_record.id=? AND grant_record.event_id=session.event_id AND grant_record.operator_user_id=session.operator_user_id AND grant_record.device_id=session.device_id AND grant_record.scanner_epoch_id=session.id))`,
      bindings: [epochId, eventId, operatorUserId, deviceId, eventId, grantId ?? null, grantId ?? null],
    });
    try {
      const results = await db.batch([guard.statement, ...statements, guard.cleanup]);
      return results.slice(1, 1 + statements.length);
    } catch (error) {
      if (isScannerLifecycleGuardFailure(error))
        throw new AppError(
          409,
          "SCANNER_PREPARATION_CLOSED",
          "Prepare an open scanner session for this operator and device before downloading offline evidence.",
        );
      throw error;
    }
  });
}
export async function enrolledOfflineEligibility(
  db: DatabaseLike,
  eventId: string,
  operatorUserId: string,
  query: z.infer<typeof enrolledOfflineEligibilityQuerySchema>,
) {
  const guarded = guardScannerPreparationDatabase(db, eventId, operatorUserId, query.deviceId, query.epochId);
  return enrolledOfflineEligibilityResponseSchema.parse({
    ...(await offlineEligibility(guarded, eventId, operatorUserId, query)),
    epochId: query.epochId,
    deviceId: query.deviceId,
  });
}
