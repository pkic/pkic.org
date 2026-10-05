export const SCAN_STORAGE_VERSION = 5;
export const SCANNER_EPOCH_STORE = "scanner-epochs";
export const SCANNER_DEVICE_STORE = "scanner-devices";
export const SCAN_STORE = "scans";
export const HISTORY_STORE = "history";
export const OFFLINE_RIGHTS_STORE = "offline-rights";
export const HISTORY_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
export function idbRequest<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error("IndexedDB request failed"));
  });
}
export function idbCompletion(transaction: IDBTransaction): Promise<void> {
  const completed = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
  // A request can reject before its caller reaches the completion await.
  void completed.catch(() => {});
  return completed;
}
export async function openScanStorage(): Promise<IDBDatabase> {
  const opening = indexedDB.open("pkic-scanner-outbox", SCAN_STORAGE_VERSION);
  opening.onupgradeneeded = () => {
    if (!opening.result.objectStoreNames.contains(SCANNER_EPOCH_STORE))
      opening.result.createObjectStore(SCANNER_EPOCH_STORE, { keyPath: "key" });
    const epochs = opening.transaction!.objectStore(SCANNER_EPOCH_STORE);
    if (!epochs.indexNames.contains("scope")) epochs.createIndex("scope", ["operatorUserId", "eventId"]);
    if (!opening.result.objectStoreNames.contains(SCANNER_DEVICE_STORE))
      opening.result.createObjectStore(SCANNER_DEVICE_STORE, { keyPath: "operatorUserId" });
    if (!opening.result.objectStoreNames.contains(OFFLINE_RIGHTS_STORE))
      opening.result.createObjectStore(OFFLINE_RIGHTS_STORE, { keyPath: "grant.id" });
    const store = opening.result.objectStoreNames.contains(SCAN_STORE)
      ? opening.transaction!.objectStore(SCAN_STORE)
      : opening.result.createObjectStore(SCAN_STORE, { keyPath: "scan.operationId" });
    if (!store.indexNames.contains("operator")) store.createIndex("operator", "scan.operatorUserId");
    if (!store.indexNames.contains("scope")) store.createIndex("scope", ["scan.operatorUserId", "eventId"]);
    if (!store.indexNames.contains("epoch")) store.createIndex("epoch", "scan.scannerSession.epochId");
    const history = opening.result.objectStoreNames.contains(HISTORY_STORE)
      ? opening.transaction!.objectStore(HISTORY_STORE)
      : opening.result.createObjectStore(HISTORY_STORE, { keyPath: "scan.operationId" });
    if (!history.indexNames.contains("scope"))
      history.createIndex("scope", ["scan.operatorUserId", "eventId", "acknowledgedAt", "scan.operationId"]);
    if (!history.indexNames.contains("expiry")) history.createIndex("expiry", "expiresAt");
  };
  return idbRequest(opening);
}
