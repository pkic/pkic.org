import {
  offlineScanRecordSchema,
  type OfflineScanRecord,
} from "../../../../../../../shared/schemas/event-participation-scanning";
import { archivedScanSchema, type ArchivedScan } from "../../../../../../../shared/schemas/event-scan-recovery";
import {
  SCAN_STORE,
  HISTORY_STORE,
  HISTORY_RETENTION_MS,
  openScanStorage,
  idbRequest,
  idbCompletion,
} from "./outbox-storage";
export type HistoryCursor = { acknowledgedAt: number; operationId: string };
export type HistoryPage = { records: ArchivedScan[]; nextCursor: HistoryCursor | null };

/** Cleanup touches acknowledged history only; unfinished operations never expire. */
export async function pruneScanHistory(db?: IDBDatabase, maximum = 128): Promise<number> {
  const storage = db ?? (await openScanStorage());
  try {
    const transaction = storage.transaction(HISTORY_STORE, "readwrite");
    const done = idbCompletion(transaction);
    const cursor = transaction
      .objectStore(HISTORY_STORE)
      .index("expiry")
      .openCursor(IDBKeyRange.upperBound(Date.now()));
    let removed = 0;
    await new Promise<void>((resolve, reject) => {
      cursor.onerror = () => reject(cursor.error ?? new Error("History cleanup failed"));
      cursor.onsuccess = () => {
        const item = cursor.result;
        if (!item || removed >= maximum) {
          resolve();
          return;
        }
        item.delete();
        removed++;
        item.continue();
      };
    });
    await done;
    return removed;
  } finally {
    if (!db) storage.close();
  }
}
function historyRange(operatorUserId: string, eventId: string, after?: HistoryCursor) {
  const earliest = Date.now() - HISTORY_RETENTION_MS + 1;
  return IDBKeyRange.bound(
    [operatorUserId, eventId, earliest],
    [operatorUserId, eventId, after?.acknowledgedAt ?? Number.MAX_SAFE_INTEGER, after?.operationId ?? "\uffff"],
    true,
    Boolean(after),
  );
}
export async function listScanHistory(
  operatorUserId: string,
  eventId: string,
  after?: HistoryCursor,
): Promise<HistoryPage> {
  const db = await openScanStorage();
  try {
    await pruneScanHistory(db);
    const transaction = db.transaction(HISTORY_STORE);
    const done = idbCompletion(transaction);
    const cursor = transaction
      .objectStore(HISTORY_STORE)
      .index("scope")
      .openCursor(historyRange(operatorUserId, eventId, after), "prev");
    const records: ArchivedScan[] = [];
    await new Promise<void>((resolve, reject) => {
      cursor.onerror = () => reject(cursor.error ?? new Error("History read failed"));
      cursor.onsuccess = () => {
        const item = cursor.result;
        if (!item || records.length >= 2001) {
          resolve();
          return;
        }
        try {
          const row = archivedScanSchema.parse(item.value);
          if (row.expiresAt > Date.now()) records.push(row);
        } catch (error) {
          reject(error instanceof Error ? error : new Error("Invalid local recovery record"));
          return;
        }
        item.continue();
      };
    });
    await done;
    const more = records.length > 2000;
    const page = records.slice(0, 2000);
    const last = page.at(-1);
    return {
      records: page,
      nextCursor: more && last ? { acknowledgedAt: last.acknowledgedAt, operationId: last.scan.operationId } : null,
    };
  } finally {
    db.close();
  }
}
export async function scanHistoryCount(operatorUserId: string, eventId: string): Promise<number> {
  const db = await openScanStorage();
  try {
    await pruneScanHistory(db);
    return await idbRequest(
      db
        .transaction(HISTORY_STORE)
        .objectStore(HISTORY_STORE)
        .index("scope")
        .count(historyRange(operatorUserId, eventId)),
    );
  } finally {
    db.close();
  }
}
/** Replays original operation IDs, so server receipts remain idempotent. Existing pending data wins. */
export async function restoreScanHistory(
  operatorUserId: string,
  eventId: string,
  after?: HistoryCursor,
): Promise<{ restored: number; nextCursor: HistoryCursor | null }> {
  const page = await listScanHistory(operatorUserId, eventId, after);
  const db = await openScanStorage();
  let restored = 0;
  try {
    const transaction = db.transaction(SCAN_STORE, "readwrite");
    const done = idbCompletion(transaction);
    const store = transaction.objectStore(SCAN_STORE);
    for (const record of page.records) {
      if (await idbRequest(store.get(record.scan.operationId))) continue;
      store.add({ eventId: record.eventId, scan: record.scan, owner: null, leaseUntil: 0 });
      restored++;
    }
    await done;
    return { restored, nextCursor: page.nextCursor };
  } finally {
    db.close();
  }
}

/** Pending operations are included in recovery files regardless of their age. */
export async function pendingRecoveryPage(
  operatorUserId: string,
  eventId: string,
  afterOperationId?: string,
): Promise<{ records: OfflineScanRecord[]; nextCursor: string | null }> {
  const db = await openScanStorage();
  try {
    const transaction = db.transaction(SCAN_STORE);
    const done = idbCompletion(transaction);
    const cursor = transaction.objectStore(SCAN_STORE).index("operator").openCursor(IDBKeyRange.only(operatorUserId));
    const records: OfflineScanRecord[] = [];
    await new Promise<void>((resolve, reject) => {
      cursor.onerror = () => reject(cursor.error ?? new Error("Pending recovery read failed"));
      cursor.onsuccess = () => {
        const item = cursor.result;
        if (!item || records.length >= 2001) {
          resolve();
          return;
        }
        try {
          const record = offlineScanRecordSchema.parse({ eventId: item.value.eventId, scan: item.value.scan });
          if (record.eventId === eventId && (!afterOperationId || record.scan.operationId > afterOperationId))
            records.push(record);
        } catch (error) {
          reject(error instanceof Error ? error : new Error("Invalid local recovery record"));
          return;
        }
        item.continue();
      };
    });
    await done;
    const more = records.length > 2000;
    const page = records.slice(0, 2000);
    return { records: page, nextCursor: more ? page.at(-1)!.scan.operationId : null };
  } finally {
    db.close();
  }
}

export async function pendingRecoveryCount(operatorUserId: string, eventId: string): Promise<number> {
  const db = await openScanStorage();
  try {
    const cursor = db
      .transaction(SCAN_STORE)
      .objectStore(SCAN_STORE)
      .index("operator")
      .openCursor(IDBKeyRange.only(operatorUserId));
    let count = 0;
    await new Promise<void>((resolve, reject) => {
      cursor.onerror = () => reject(cursor.error ?? new Error("Pending count failed"));
      cursor.onsuccess = () => {
        const item = cursor.result;
        if (!item) {
          resolve();
          return;
        }
        if (item.value.eventId === eventId) count++;
        item.continue();
      };
    });
    return count;
  } finally {
    db.close();
  }
}
