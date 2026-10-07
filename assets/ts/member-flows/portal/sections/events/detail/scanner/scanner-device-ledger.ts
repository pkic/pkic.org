import {
  enrolledEventScanRequestSchema,
  type OfflineScanRecord,
} from "../../../../../../../shared/schemas/event-participation-scanning";
import {
  SCANNER_RECOVERY_EPOCH_LIMIT,
  scannerDeviceSessionEnrollmentSchema,
  scannerDeviceSessionEnrollmentResponseSchema,
  scannerDeviceSessionClosingSchema,
  scannerDeviceSessionStatusSchema,
} from "../../../../../../../shared/schemas/event-scanner-devices";
import { ApiClientError, getJson, postJson } from "../../../../../../shared/api-client";
import type { ScannerOfflineContext } from "../../../../../../../shared/schemas/event-scanner-offline-context";
import { scannerOfflineContextMatches } from "./scanner-offline-context";
import {
  SCANNER_DEVICE_STORE,
  SCANNER_EPOCH_STORE,
  SCAN_STORE,
  openScanStorage,
  idbRequest,
  idbCompletion,
} from "./outbox-storage";
export type ScannerEpoch = {
  key: string;
  eventId: string;
  operatorUserId: string;
  deviceId: string;
  enrollmentOperationId: string;
  epochId: string | null;
  openedAt: string | null;
  issuedHighWater: number;
  state: "preparing" | "open" | "closing" | "closed";
  closingOperationId: string | null;
};
const epochKey = (eventId: string, operatorUserId: string, deviceId: string) =>
  JSON.stringify([eventId, operatorUserId, deviceId]);
export async function prepareScannerDevice(operatorUserId: string): Promise<string> {
  const db = await openScanStorage();
  try {
    const transaction = db.transaction(SCANNER_DEVICE_STORE, "readwrite"),
      done = idbCompletion(transaction);
    const store = transaction.objectStore(SCANNER_DEVICE_STORE);
    const existing = await idbRequest<{ operatorUserId: string; deviceId: string } | undefined>(
      store.get(operatorUserId),
    );
    const deviceId = existing?.deviceId ?? crypto.randomUUID();
    if (!existing) store.add({ operatorUserId, deviceId });
    await done;
    return deviceId;
  } finally {
    db.close();
  }
}
/** Enrollment runs during preparation, never while processing camera frames. */
export async function prepareScannerEpoch(
  eventId: string,
  operatorUserId: string,
  deviceId: string,
  sponsorId?: string,
): Promise<ScannerEpoch> {
  const db = await openScanStorage();
  let epoch: ScannerEpoch;
  try {
    const transaction = db.transaction(SCANNER_EPOCH_STORE, "readwrite"),
      done = idbCompletion(transaction);
    const store = transaction.objectStore(SCANNER_EPOCH_STORE),
      key = epochKey(eventId, operatorUserId, deviceId);
    const existing = await idbRequest<ScannerEpoch | undefined>(store.get(key));
    epoch = existing ?? {
      key,
      eventId,
      operatorUserId,
      deviceId,
      enrollmentOperationId: crypto.randomUUID(),
      epochId: null,
      openedAt: null,
      issuedHighWater: 0,
      state: "preparing",
      closingOperationId: null,
    };
    if (!existing) store.add(epoch);
    await done;
    if (epoch.state !== "preparing") return await refreshScannerEpoch(db, epoch, sponsorId);
    const response = await postJson(
      `/api/v1/events/${encodeURIComponent(eventId)}/scanner/devices/sessions`,
      scannerDeviceSessionEnrollmentSchema.parse({
        operationId: epoch.enrollmentOperationId,
        deviceId,
        ...(sponsorId ? { sponsorId } : {}),
      }),
      scannerDeviceSessionEnrollmentResponseSchema,
    );
    if (response.operatorUserId !== operatorUserId || response.deviceId !== deviceId)
      throw new Error("Scanner enrollment owner changed");
    const write = db.transaction(SCANNER_EPOCH_STORE, "readwrite"),
      written = idbCompletion(write),
      epochs = write.objectStore(SCANNER_EPOCH_STORE);
    const current = await idbRequest<ScannerEpoch>(epochs.get(key));
    // An enrollment retry must never reset an issued counter or reopen a frozen epoch.
    if (current.state === "preparing") {
      epoch = { ...current, epochId: response.epochId, openedAt: response.openedAt, state: "open" };
      epochs.put(epoch);
    } else epoch = current;
    await written;
    return epoch;
  } finally {
    db.close();
  }
}
/** A later shift gets a new enrollment; the closed epoch remains durable recovery evidence. */
export async function startNextScannerEpoch(
  eventId: string,
  operatorUserId: string,
  deviceId: string,
  sponsorId?: string,
): Promise<ScannerEpoch> {
  const db = await openScanStorage();
  try {
    const transaction = db.transaction(SCANNER_EPOCH_STORE, "readwrite"),
      done = idbCompletion(transaction),
      store = transaction.objectStore(SCANNER_EPOCH_STORE);
    const key = epochKey(eventId, operatorUserId, deviceId),
      current = await idbRequest<ScannerEpoch | undefined>(store.get(key));
    if (!current || (current.state !== "closed" && current.state !== "preparing")) {
      transaction.abort();
      throw new Error("Close the current scanner session before starting the next session");
    }
    if (current.state === "closed") {
      const retained = await idbRequest(store.index("scope").count(IDBKeyRange.only([operatorUserId, eventId])));
      if (retained >= SCANNER_RECOVERY_EPOCH_LIMIT) {
        transaction.abort();
        throw new Error("Scanner session storage limit reached. Retained evidence has been kept.");
      }
      store.add({
        ...current,
        key: JSON.stringify([eventId, operatorUserId, deviceId, current.enrollmentOperationId]),
      });
      store.put({
        ...current,
        key,
        enrollmentOperationId: crypto.randomUUID(),
        epochId: null,
        openedAt: null,
        issuedHighWater: 0,
        state: "preparing",
        closingOperationId: null,
      } satisfies ScannerEpoch);
    }
    await done;
  } finally {
    db.close();
  }
  return prepareScannerEpoch(eventId, operatorUserId, deviceId, sponsorId);
}

/** Reconcile saved authorization during preparation; capture never fetches this status. */
async function refreshScannerEpoch(db: IDBDatabase, epoch: ScannerEpoch, sponsorId?: string): Promise<ScannerEpoch> {
  if (epoch.state !== "open" || !epoch.epochId || !navigator.onLine) return epoch;
  let status;
  try {
    const query = sponsorId ? `?${new URLSearchParams({ sponsorId })}` : "";
    status = await getJson(
      `/api/v1/events/${encodeURIComponent(epoch.eventId)}/scanner/devices/sessions/${encodeURIComponent(epoch.epochId)}${query}`,
      scannerDeviceSessionStatusSchema,
      { signal: AbortSignal.timeout(8000) },
    );
  } catch (error) {
    // Only connectivity failures permit saved offline authorization. Refusals and malformed status fail closed.
    if (error instanceof ApiClientError && error.status === 0) return epoch;
    throw error;
  }
  if (status.epochId !== epoch.epochId) throw new Error("Scanner status belongs to another session");
  if ((status.closedAt || status.closingDeclaredAt) && !status.closingOperationId)
    throw new Error("Scanner status is missing the original closing operation");
  const transaction = db.transaction(SCANNER_EPOCH_STORE, "readwrite"),
    done = idbCompletion(transaction),
    store = transaction.objectStore(SCANNER_EPOCH_STORE);
  const current = await idbRequest<ScannerEpoch>(store.get(epoch.key));
  const refreshed: ScannerEpoch = status.closedAt
    ? { ...current, state: "closed", closingOperationId: status.closingOperationId }
    : status.closingDeclaredAt && current.state === "open"
      ? { ...current, state: "closing", closingOperationId: status.closingOperationId }
      : current;
  store.put(refreshed);
  await done;
  return refreshed;
}

/** Caller includes this store in the same transaction as queue insertion. */
export async function sequenceScannerRecord(
  transaction: IDBTransaction,
  record: OfflineScanRecord,
  collector?: ScannerOfflineContext,
): Promise<OfflineScanRecord> {
  const store = transaction.objectStore(SCANNER_EPOCH_STORE);
  const epoch = await idbRequest<(ScannerEpoch & { collectorContext?: unknown }) | undefined>(
    store.get(epochKey(record.eventId, record.scan.operatorUserId, record.scan.deviceId)),
  );
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
      record.scan.capturePublicationRevision !== collector.publishedRevision ||
      JSON.stringify(record.scan.nativeEventContext) !== JSON.stringify(collector.nativeEventContext) ||
      !scannerOfflineContextMatches(collector, epoch.collectorContext))
  ) {
    transaction.abort();
    throw new Error("The scanner context changed. Reconnect before continuing.");
  }
  const sequence = epoch.issuedHighWater + 1;
  if (!Number.isSafeInteger(sequence)) {
    transaction.abort();
    throw new Error("Scanner sequence exhausted");
  }
  let scan: OfflineScanRecord["scan"];
  try {
    scan = enrolledEventScanRequestSchema.parse({
      ...record.scan,
      scannerSession: { epochId: epoch.epochId, sequence },
    });
  } catch (error) {
    transaction.abort();
    throw error;
  }
  store.put({ ...epoch, issuedHighWater: sequence });
  return { ...record, scan };
}
export async function freezeScannerEpoch(
  eventId: string,
  operatorUserId: string,
  deviceId: string,
): Promise<ScannerEpoch> {
  const db = await openScanStorage();
  try {
    const transaction = db.transaction(SCANNER_EPOCH_STORE, "readwrite"),
      done = idbCompletion(transaction),
      store = transaction.objectStore(SCANNER_EPOCH_STORE);
    const epoch = await idbRequest<ScannerEpoch | undefined>(store.get(epochKey(eventId, operatorUserId, deviceId)));
    if (!epoch?.epochId) {
      transaction.abort();
      throw new Error("Scanner session has not been enrolled");
    }
    const frozen: ScannerEpoch =
      epoch.state === "open" ? { ...epoch, state: "closing", closingOperationId: crypto.randomUUID() } : epoch;
    store.put(frozen);
    await done;
    return frozen;
  } finally {
    db.close();
  }
}
export async function closeScannerEpoch(epoch: ScannerEpoch, sponsorId?: string): Promise<ScannerEpoch> {
  if (!epoch.epochId || !epoch.closingOperationId || epoch.state !== "closing")
    throw new Error("Freeze scanner session before closing");
  const db = await openScanStorage();
  try {
    const transaction = db.transaction(SCAN_STORE),
      done = idbCompletion(transaction);
    const pending = await idbRequest(transaction.objectStore(SCAN_STORE).index("epoch").count(epoch.epochId));
    await done;
    if (pending > 0) throw new Error("Upload pending scans before closing this session");
    const status = await postJson(
      `/api/v1/events/${encodeURIComponent(epoch.eventId)}/scanner/devices/sessions/${encodeURIComponent(epoch.epochId)}/closing`,
      scannerDeviceSessionClosingSchema.parse({
        operationId: epoch.closingOperationId,
        highWaterSequence: epoch.issuedHighWater,
        pendingCount: 0,
        recoveryCount: 0,
        ...(sponsorId ? { sponsorId } : {}),
      }),
      scannerDeviceSessionStatusSchema,
    );
    if (
      status.epochId !== epoch.epochId ||
      status.closingOperationId !== epoch.closingOperationId ||
      status.highWaterSequence !== epoch.issuedHighWater ||
      status.receivedCount !== epoch.issuedHighWater ||
      status.missingCount !== 0 ||
      !status.closedAt
    )
      throw new Error("Server scanner coverage is incomplete");
    const write = db.transaction(SCANNER_EPOCH_STORE, "readwrite"),
      written = idbCompletion(write);
    const closed: ScannerEpoch = { ...epoch, state: "closed" };
    write.objectStore(SCANNER_EPOCH_STORE).put(closed);
    await written;
    return closed;
  } finally {
    db.close();
  }
}
