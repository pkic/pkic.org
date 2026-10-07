import {
  offlineScanRecordSchema,
  type OfflineScanRecord,
} from "../../../../../../../shared/schemas/event-participation-scanning";
import { openScanStorage, SCAN_STORE, idbCompletion, idbRequest } from "./outbox-storage";

/** Read one bounded page from the existing operator/event index, never raw credentials into the UI. */
export async function recentPendingScans(
  operatorUserId: string,
  eventId: string,
): Promise<{ records: OfflineScanRecord[]; total: number }> {
  const db = await openScanStorage();
  try {
    const transaction = db.transaction(SCAN_STORE),
      done = idbCompletion(transaction);
    const index = transaction.objectStore(SCAN_STORE).index("scope"),
      range = IDBKeyRange.only([operatorUserId, eventId]);
    const count = idbRequest(index.count(range));
    const cursor = index.openCursor(range, "prev");
    const records: OfflineScanRecord[] = [];
    await new Promise<void>((resolve, reject) => {
      cursor.onerror = () => reject(cursor.error ?? new Error("Pending scans unavailable"));
      cursor.onsuccess = () => {
        const item = cursor.result;
        if (!item || records.length >= 20) return resolve();
        try {
          const record = offlineScanRecordSchema.strip().parse(item.value);
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
