import { scannerReconciliationSchema } from "../../../../assets/shared/schemas/event-scanner-reconciliation";
import { first } from "../../db/queries";
import { persistedUtcInstant } from "../../utils/time";
import type { DatabaseLike } from "../../types";

/** One indexed aggregate snapshot over all attendance, checkout and sponsor scanner epochs. */
export async function eventScannerReconciliation(db: DatabaseLike, eventId: string) {
  const row = await first<{
    coverageStartedAt: string | null;
    sourceState: "live" | "retention_in_progress" | "purged";
    preservedSnapshot: string | null;
    knownEpochs: number;
    openEpochs: number;
    closingEpochs: number;
    closedEpochs: number;
    unknownHighWaterEpochs: number;
    missingDeclaredReceipts: number;
    unprovenClosedEpochs: number;
    untrackedAttempts: number;
    unclosedGrants: number;
  }>(
    db,
    `WITH epochs AS (
    SELECT session.id,session.high_water_sequence,session.closed_at FROM event_scanner_device_sessions session WHERE session.event_id=?
  ), receipts AS (
    SELECT receipt.epoch_id,COUNT(*) AS received,MAX(receipt.sequence) AS highest FROM event_scanner_upload_receipts receipt JOIN epochs ON epochs.id=receipt.epoch_id GROUP BY receipt.epoch_id
  ) SELECT
    (SELECT coverage_started_at FROM event_scanner_reconciliation_coverage WHERE event_id=?) AS coverageStartedAt,
    COALESCE((SELECT CASE WHEN retained.purged_at IS NOT NULL THEN 'purged' WHEN retained.active_run_id IS NOT NULL THEN 'retention_in_progress' ELSE 'live' END FROM event_evidence_retention_state retained WHERE retained.event_id=?),'live') AS sourceState,
    (SELECT run.reconciliation_json FROM event_evidence_retention_state retained
     JOIN event_evidence_retention_runs run ON run.event_id=retained.event_id
     AND ((retained.purged_at IS NULL AND retained.active_run_id=run.id AND run.status='running')
       OR (retained.active_run_id IS NULL AND retained.purged_at=run.completed_at AND run.status='complete'))
     WHERE retained.event_id=? ORDER BY run.started_at DESC,run.id LIMIT 1) AS preservedSnapshot,
    COUNT(*) AS knownEpochs,
    COALESCE(SUM(epochs.closed_at IS NULL AND epochs.high_water_sequence IS NULL),0) AS openEpochs,
    COALESCE(SUM(epochs.closed_at IS NULL AND epochs.high_water_sequence IS NOT NULL),0) AS closingEpochs,
    COALESCE(SUM(epochs.closed_at IS NOT NULL),0) AS closedEpochs,
    COALESCE(SUM(epochs.high_water_sequence IS NULL),0) AS unknownHighWaterEpochs,
    COALESCE(SUM(CASE WHEN epochs.high_water_sequence IS NULL THEN 0 ELSE MAX(0,epochs.high_water_sequence-COALESCE(receipts.received,0)) END),0) AS missingDeclaredReceipts,
    COALESCE(SUM(epochs.closed_at IS NOT NULL AND (epochs.high_water_sequence IS NULL OR COALESCE(receipts.received,0)<>epochs.high_water_sequence OR COALESCE(receipts.highest,0)>epochs.high_water_sequence)),0) AS unprovenClosedEpochs,
    (SELECT COUNT(*) FROM event_scan_attempts attempt WHERE attempt.event_id=? AND NOT EXISTS(
      SELECT 1 FROM event_scanner_upload_receipts receipt JOIN event_scanner_device_sessions session ON session.id=receipt.epoch_id
      WHERE receipt.operation_id=attempt.operation_id AND session.event_id=attempt.event_id AND session.operator_user_id=attempt.operator_user_id AND session.device_id=attempt.device_id)) AS untrackedAttempts,
    (SELECT COUNT(*) FROM event_offline_admission_grants grant_record WHERE grant_record.event_id=? AND grant_record.closed_at IS NULL) AS unclosedGrants
    FROM epochs LEFT JOIN receipts ON receipts.epoch_id=epochs.id`,
    [eventId, eventId, eventId, eventId, eventId, eventId],
  );
  if (!row) throw new Error("Scanner reconciliation aggregate unavailable");
  const { preservedSnapshot, ...source } = row;
  if (source.sourceState !== "live" && preservedSnapshot !== null) {
    const preserved = scannerReconciliationSchema.parse(JSON.parse(preservedSnapshot));
    return scannerReconciliationSchema.parse({ ...preserved, sourceState: source.sourceState });
  }
  const unknown = row.coverageStartedAt === null || row.untrackedAttempts > 0 || row.sourceState !== "live";
  const pending =
    row.openEpochs > 0 ||
    row.closingEpochs > 0 ||
    row.unknownHighWaterEpochs > 0 ||
    row.missingDeclaredReceipts > 0 ||
    row.unprovenClosedEpochs > 0 ||
    row.unclosedGrants > 0;
  return scannerReconciliationSchema.parse({
    ...source,
    coverageStartedAt: persistedUtcInstant(source.coverageStartedAt),
    scope: "event",
    coverage: row.coverageStartedAt === null ? "legacy_unknown" : "from_event_creation",
    deviceBacklog: unknown ? "unknown" : pending ? "pending" : "complete",
  });
}
