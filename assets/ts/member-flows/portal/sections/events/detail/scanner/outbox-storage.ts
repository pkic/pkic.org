export const SCAN_STORE = "scans";
export const HISTORY_STORE = "history";
export const HISTORY_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
export function idbRequest<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error("IndexedDB request failed"));
  });
}
export function idbCompletion(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}
export async function openScanStorage(): Promise<IDBDatabase> {
  const opening = indexedDB.open("pkic-scanner-outbox", 3);
  opening.onupgradeneeded = () => {
    const store = opening.result.objectStoreNames.contains(SCAN_STORE)
      ? opening.transaction!.objectStore(SCAN_STORE)
      : opening.result.createObjectStore(SCAN_STORE, { keyPath: "scan.operationId" });
    if (!store.indexNames.contains("operator")) store.createIndex("operator", "scan.operatorUserId");
    const history = opening.result.objectStoreNames.contains(HISTORY_STORE)
      ? opening.transaction!.objectStore(HISTORY_STORE)
      : opening.result.createObjectStore(HISTORY_STORE, { keyPath: "scan.operationId" });
    if (!history.indexNames.contains("scope"))
      history.createIndex("scope", ["scan.operatorUserId", "eventId", "acknowledgedAt", "scan.operationId"]);
    if (!history.indexNames.contains("expiry")) history.createIndex("expiry", "expiresAt");
  };
  return idbRequest(opening);
}
