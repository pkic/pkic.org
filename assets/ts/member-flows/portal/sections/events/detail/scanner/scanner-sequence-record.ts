import {
  enrolledScannerQueueRecordSchema,
  type ScannerQueueCapture,
  type ScannerQueueRecord,
} from "../../../../../../../shared/schemas/event-scanner-offline-queue";
import type { ScannerOfflineContext } from "../../../../../../../shared/schemas/event-scanner-offline-context";
import type { ScannerEpoch } from "./scanner-device-ledger";
import { scannerOfflineEpochContextMatches } from "./scanner-offline-context";
import { SCANNER_EPOCH_STORE, idbRequest } from "./outbox-storage";

export const scannerEpochKey = (eventId: string, operatorUserId: string, deviceId: string) =>
  JSON.stringify([eventId, operatorUserId, deviceId]);

/** Caller includes this store in the same transaction as queue insertion. */
export async function sequenceScannerRecord(
  transaction: IDBTransaction,
  record: ScannerQueueCapture,
  collector?: ScannerOfflineContext,
): Promise<ScannerQueueRecord> {
  const store = transaction.objectStore(SCANNER_EPOCH_STORE);
  const epoch = await idbRequest<
    (ScannerEpoch & { collectorContext?: unknown; collectorContexts?: unknown }) | undefined
  >(store.get(scannerEpochKey(record.eventId, record.scan.operatorUserId, record.scan.deviceId)));
  if (!epoch || epoch.state !== "open" || !epoch.epochId) {
    transaction.abort();
    throw new Error("Prepare an open scanner session before capturing scans");
  }
  if (
    collector &&
    (epoch.epochId !== collector.epochId ||
      record.eventId !== collector.slug ||
      record.scan.operatorUserId !== collector.operatorUserId ||
      record.scan.deviceId !== collector.deviceId ||
      record.scan.action !== collector.action ||
      record.scan.occurrenceId !== collector.occurrenceId ||
      (record.scan.roomId ?? null) !== collector.roomId ||
      (record.kind === "scan" &&
        (record.scan.capturePublicationRevision !== collector.publishedRevision ||
          JSON.stringify(record.scan.nativeEventContext) !== JSON.stringify(collector.nativeEventContext))) ||
      !scannerOfflineEpochContextMatches(collector, epoch))
  ) {
    transaction.abort();
    throw new Error("The scanner context changed. Reconnect before continuing.");
  }
  const sequence = epoch.issuedHighWater + 1;
  if (!Number.isSafeInteger(sequence)) {
    transaction.abort();
    throw new Error("Scanner sequence exhausted");
  }
  let sequenced: ScannerQueueRecord;
  try {
    sequenced = enrolledScannerQueueRecordSchema.parse({
      ...record,
      scan: {
        ...record.scan,
        scannerSession: { epochId: epoch.epochId, sequence },
      },
    });
  } catch (error) {
    transaction.abort();
    throw error;
  }
  store.put({ ...epoch, issuedHighWater: sequence });
  return sequenced;
}
