import {
  offlineScanRecordSchema,
  eventScanResponseSchema,
  type OfflineScanRecord,
} from "../../../../../../../shared/schemas/event-participation-scanning";

type QueuedScan = OfflineScanRecord & {
  leaseUntil: number;
  owner: string | null;
  attempts?: number;
  nextAttemptAt?: number;
};
const STORE = "scans";
const DATABASE = "pkic-scanner-outbox";

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error("IndexedDB request failed"));
  });
}
function completion(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("Queue transaction aborted"));
  });
}
async function openOutbox(): Promise<IDBDatabase> {
  const opening = indexedDB.open(DATABASE, 2);
  opening.onupgradeneeded = () => {
    const store = opening.result.objectStoreNames.contains(STORE)
      ? opening.transaction!.objectStore(STORE)
      : opening.result.createObjectStore(STORE, { keyPath: "scan.operationId" });
    if (!store.indexNames.contains("operator")) store.createIndex("operator", "scan.operatorUserId");
  };
  return request(opening);
}

export async function queueScan(record: OfflineScanRecord): Promise<void> {
  const parsed = offlineScanRecordSchema.parse(record);
  const db = await openOutbox();
  try {
    const transaction = db.transaction(STORE, "readwrite");
    const done = completion(transaction);
    // Add protects an existing retry and lease from accidental overwrite.
    transaction.objectStore(STORE).add({ ...parsed, leaseUntil: 0, owner: null });
    await done;
  } finally {
    db.close();
  }
}

async function claimScan(db: IDBDatabase, owner: string, operatorUserId?: string): Promise<QueuedScan | null> {
  const transaction = db.transaction(STORE, "readwrite");
  const done = completion(transaction);
  const store = transaction.objectStore(STORE);
  const cursor = store.openCursor();
  const selected = await new Promise<QueuedScan | null>((resolve, reject) => {
    cursor.onerror = () => reject(cursor.error ?? new Error("IndexedDB cursor failed"));
    cursor.onsuccess = () => {
      const current = cursor.result;
      if (!current) {
        resolve(null);
        return;
      }
      const value = current.value as QueuedScan;
      if (
        (value.nextAttemptAt ?? 0) > Date.now() ||
        value.leaseUntil > Date.now() ||
        (operatorUserId && value.scan.operatorUserId !== operatorUserId)
      ) {
        current.continue();
        return;
      }
      const claimed = { ...value, owner, leaseUntil: Date.now() + 30_000 };
      current.update(claimed);
      resolve(claimed);
    };
  });
  await done;
  return selected;
}

export type ScanDrainResult = {
  uploaded: number;
  retryAfterMs?: number;
  state: "complete" | "authentication_required" | "retry";
};
/** Shared by foreground and worker. A receipt is required before deleting anything. */
export async function drainScanOutbox(
  upload: (record: OfflineScanRecord) => Promise<Response>,
  operatorUserId?: string,
): Promise<ScanDrainResult> {
  const db = await openOutbox();
  const owner = crypto.randomUUID();
  let uploaded = 0;
  try {
    for (let count = 0; count < 100; count++) {
      const queued = await claimScan(db, owner, operatorUserId);
      if (!queued) {
        const deferred = await request<QueuedScan[]>(db.transaction(STORE).objectStore(STORE).getAll());
        const own = deferred.filter((item) => !operatorUserId || item.scan.operatorUserId === operatorUserId);
        if (!own.length) return { uploaded, state: "complete" };
        const next = Math.min(...own.map((item) => Math.max(item.nextAttemptAt ?? 0, item.leaseUntil)));
        return { uploaded, state: "retry", retryAfterMs: Math.max(1000, next - Date.now()) };
      }
      let acknowledged = false;
      let state: ScanDrainResult["state"] = "retry";
      const attempts = (queued.attempts ?? 0) + 1;
      let retryAfterMs = Math.min(60_000, 1000 * 2 ** Math.min(attempts, 6)) + Math.floor(Math.random() * 1000);
      try {
        const response = await upload(offlineScanRecordSchema.parse({ eventId: queued.eventId, scan: queued.scan }));
        if (response.status === 429 || response.status === 503) {
          const header = response.headers.get("retry-after");
          if (header) {
            const seconds = Number(header);
            const wait = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
            if (Number.isFinite(wait)) retryAfterMs = Math.max(retryAfterMs, Math.min(86_400_000, wait));
          }
        }
        if (response.status === 401 || response.status === 403) state = "authentication_required";
        else if (response.ok) {
          const receipt = eventScanResponseSchema.parse(await response.json());
          acknowledged = receipt.operationId === queued.scan.operationId;
        }
      } catch {
        /* Retain the queued operation for a later attempt. */
      }
      const transaction = db.transaction(STORE, "readwrite");
      const done = completion(transaction);
      const store = transaction.objectStore(STORE);
      const current = await request<QueuedScan | undefined>(store.get(queued.scan.operationId));
      if (current?.owner === owner) {
        if (acknowledged) store.delete(queued.scan.operationId);
        else
          store.put({
            ...current,
            owner: null,
            leaseUntil: 0,
            attempts,
            nextAttemptAt: state === "authentication_required" ? 0 : Date.now() + retryAfterMs,
          });
      }
      await done;
      if (!acknowledged) return { uploaded, state, retryAfterMs };
      uploaded++;
    }
    return { uploaded, state: "retry", retryAfterMs: 100 };
  } finally {
    db.close();
  }
}

export async function clearScanOutbox(): Promise<void> {
  const db = await openOutbox();
  try {
    const transaction = db.transaction(STORE, "readwrite");
    const done = completion(transaction);
    transaction.objectStore(STORE).clear();
    await done;
  } finally {
    db.close();
  }
}
export async function pendingScanCount(operatorUserId: string): Promise<number> {
  const db = await openOutbox();
  try {
    return await request(db.transaction(STORE, "readonly").objectStore(STORE).index("operator").count(operatorUserId));
  } finally {
    db.close();
  }
}
