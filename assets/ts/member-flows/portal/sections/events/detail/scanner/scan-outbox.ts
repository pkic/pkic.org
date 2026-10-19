import { readActiveUserSession, scannerUploadSuspended } from "../../../../../../shared/pending-user-logout";
import { sequenceScannerRecord } from "./scanner-device-ledger";
import type { ScannerOfflineContext } from "../../../../../../../shared/schemas/event-scanner-offline-context";
import { scannerReceiptMatches } from "./scanner-receipt";
import {
  offlineScanRecordSchema,
  eventScanResponseSchema,
  type OfflineScanRecord,
  type EventScanResponse,
} from "../../../../../../../shared/schemas/event-participation-scanning";

import {
  scannerQueueCaptureSchema,
  enrolledScannerQueueRecordSchema,
  type ScannerQueueCapture,
  type ScannerQueueRecord,
} from "../../../../../../../shared/schemas/event-scanner-offline-queue";

type QueuedScan = ScannerQueueRecord & {
  leaseUntil: number;
  owner: string | null;
  attempts?: number;
  nextAttemptAt?: number;
};
import {
  SCAN_STORE as STORE,
  SCANNER_EPOCH_STORE,
  HISTORY_STORE,
  HISTORY_RETENTION_MS,
  openScanStorage as openOutbox,
  idbRequest as request,
  idbCompletion as completion,
} from "./outbox-storage";
import { pruneScanHistory } from "./scan-history";
import { archivedScanSchema, type ArchivedScan } from "../../../../../../../shared/schemas/event-scan-recovery";

/** Ask the browser to retry pending scans; foreground sync remains available without this capability. */
export async function requestScanOutboxBackgroundSync() {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration("/portal/");
  if (registration && "sync" in registration)
    void (registration as ServiceWorkerRegistration & { sync: { register(tag: string): Promise<void> } }).sync
      .register("pkic-scanner-upload")
      .catch(() => {});
}

export async function queueScan(
  record: OfflineScanRecord,
  sessionId?: string,
  collector?: ScannerOfflineContext,
): Promise<OfflineScanRecord["scan"]> {
  const queued = await queueScannerAttempt(
    { ...offlineScanRecordSchema.parse(record), kind: "scan" },
    sessionId,
    collector,
  );
  if (queued.kind !== "scan") throw new Error("Expected badge scan");
  return queued.scan;
}

export async function queueScannerAttempt(
  record: ScannerQueueCapture,
  sessionId?: string,
  collector?: ScannerOfflineContext,
): Promise<ScannerQueueRecord> {
  const parsed = scannerQueueCaptureSchema.parse(record);
  if (await scannerUploadSuspended(parsed.scan.operatorUserId, sessionId))
    throw new Error("Sign in again before capturing scans.");
  const db = await openOutbox();
  try {
    const transaction = db.transaction([STORE, SCANNER_EPOCH_STORE], "readwrite");
    const done = completion(transaction);
    let sequenced: ScannerQueueRecord;
    try {
      sequenced = await sequenceScannerRecord(transaction, parsed, collector);
    } catch (error) {
      await done.catch(() => {});
      throw error;
    }
    // Add protects an existing retry and lease from accidental overwrite.
    transaction.objectStore(STORE).add({ ...sequenced, leaseUntil: 0, owner: null });
    await done;
    return sequenced;
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

import type { ScanDrainResult } from "../../../../../../../shared/schemas/event-scan-upload-status";
export type { ScanDrainResult } from "../../../../../../../shared/schemas/event-scan-upload-status";
/** Shared by foreground and worker. A receipt is required before deleting anything. */
export async function drainScanOutbox(
  upload: (record: ScannerQueueRecord) => Promise<Response>,
  operatorUserId?: string,
  sessionId?: string,
): Promise<ScanDrainResult> {
  const active = await readActiveUserSession();
  if (
    !active ||
    (operatorUserId && active.operatorUserId !== operatorUserId) ||
    (sessionId !== undefined && active.sessionId !== sessionId) ||
    (await scannerUploadSuspended(active.operatorUserId, active.sessionId))
  )
    return { uploaded: 0, state: "authentication_required" };
  operatorUserId = active.operatorUserId;
  const db = await openOutbox();
  const owner = crypto.randomUUID();
  let uploaded = 0;
  try {
    for (let count = 0; count < 100; count++) {
      if (await scannerUploadSuspended(operatorUserId, active.sessionId))
        return { uploaded, state: "authentication_required" };
      const queued = await claimScan(db, owner, operatorUserId);
      if (!queued) {
        const deferred = await request<QueuedScan[]>(db.transaction(STORE).objectStore(STORE).getAll());
        const own = deferred.filter((item) => !operatorUserId || item.scan.operatorUserId === operatorUserId);
        if (!own.length) return { uploaded, state: "complete" };
        const next = Math.min(...own.map((item) => Math.max(item.nextAttemptAt ?? 0, item.leaseUntil)));
        return { uploaded, state: "retry", retryAfterMs: Math.max(1000, next - Date.now()) };
      }
      let acknowledged = false;
      let receipt: EventScanResponse | null = null;
      const uploadRecord = enrolledScannerQueueRecordSchema.safeParse({
        kind: queued.kind,
        eventId: queued.eventId,
        scan: queued.scan,
      });
      let state: ScanDrainResult["state"] = uploadRecord.success ? "retry" : "recovery_required";
      const attempts = (queued.attempts ?? 0) + 1;
      let retryAfterMs = Math.min(60_000, 1000 * 2 ** Math.min(attempts, 6)) + Math.floor(Math.random() * 1000);
      try {
        if (!uploadRecord.success) throw new Error("Retained scanner record requires recovery");
        const response = (await scannerUploadSuspended(operatorUserId, active.sessionId))
          ? new Response(null, { status: 401 })
          : await upload(
              enrolledScannerQueueRecordSchema.parse({ kind: queued.kind, eventId: queued.eventId, scan: queued.scan }),
            );
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
          receipt = eventScanResponseSchema.parse(await response.json());
          acknowledged = scannerReceiptMatches(receipt, queued.scan);
        }
      } catch {
        /* Retain the queued operation for a later attempt. */
      }
      const transaction = db.transaction([STORE, HISTORY_STORE], "readwrite");
      const done = completion(transaction);
      const store = transaction.objectStore(STORE);
      const current = await request<QueuedScan | undefined>(store.get(queued.scan.operationId));
      if (current?.owner === owner) {
        if (acknowledged && receipt) {
          const history = transaction.objectStore(HISTORY_STORE);
          const existing = await request<ArchivedScan | undefined>(history.get(queued.scan.operationId));
          const acknowledgedAt = Date.now();
          if (!existing)
            history.put(
              archivedScanSchema.parse({
                kind: queued.kind,
                eventId: queued.eventId,
                scan: queued.scan,
                receipt,
                acknowledgedAt,
                expiresAt: acknowledgedAt + HISTORY_RETENTION_MS,
              }),
            );
          store.delete(queued.scan.operationId);
        } else
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
    try {
      await pruneScanHistory(db);
    } catch {
      /* Retry acknowledged-history cleanup on the next visit. */
    }
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

/** Confirm pending or acknowledged persistence before recording a separate storage-failure audit. */
export async function scannerOperationRetained(
  operationId: string,
  operatorUserId: string,
  eventId: string,
): Promise<boolean> {
  const db = await openOutbox();
  try {
    const transaction = db.transaction([STORE, HISTORY_STORE]),
      done = completion(transaction);
    const records = await Promise.all(
      [STORE, HISTORY_STORE].map((name) =>
        request<ScannerQueueRecord | undefined>(transaction.objectStore(name).get(operationId)),
      ),
    );
    await done;
    return records.some(
      (record) =>
        record?.eventId === eventId &&
        record.scan.operatorUserId === operatorUserId &&
        record.scan.operationId === operationId,
    );
  } finally {
    db.close();
  }
}
