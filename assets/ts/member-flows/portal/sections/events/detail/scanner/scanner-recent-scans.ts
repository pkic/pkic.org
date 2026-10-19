import {
  scannerQueueRecordSchema,
  type ScannerQueueRecord,
} from "../../../../../../../shared/schemas/event-scanner-offline-queue";
import { openScanStorage, SCAN_STORE, idbCompletion, idbRequest } from "./outbox-storage";

/** Read one bounded page; the queue itself retains every unacknowledged attempt. */
export async function recentPendingScans(
  operatorUserId: string,
  eventId: string,
): Promise<{ records: ScannerQueueRecord[]; total: number }> {
  const db = await openScanStorage();
  try {
    const transaction = db.transaction(SCAN_STORE),
      done = idbCompletion(transaction);
    const index = transaction.objectStore(SCAN_STORE).index("recent"),
      range = IDBKeyRange.bound([operatorUserId, eventId], [operatorUserId, eventId, "\uffff", "\uffff"]);
    const count = idbRequest(index.count(range));
    const cursor = index.openCursor(range, "prev");
    const records: ScannerQueueRecord[] = [];
    await new Promise<void>((resolve, reject) => {
      cursor.onerror = () => reject(cursor.error ?? new Error("Pending scans unavailable"));
      cursor.onsuccess = () => {
        const item = cursor.result;
        if (!item || records.length >= 20) return resolve();
        try {
          const record = scannerQueueRecordSchema.parse({
            kind: item.value.kind,
            eventId: item.value.eventId,
            scan: item.value.scan,
          });
          if (record.eventId !== eventId || record.scan.operatorUserId !== operatorUserId)
            throw new Error("Pending scan belongs to another scope");
          records.push(record);
          item.continue();
        } catch (error) {
          reject(error instanceof Error ? error : new Error("Pending scan is invalid"));
        }
      };
    });
    await done;
    return { records, total: await count };
  } finally {
    db.close();
  }
}
