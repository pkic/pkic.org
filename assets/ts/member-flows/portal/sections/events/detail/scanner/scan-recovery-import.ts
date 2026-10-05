import { z } from "zod";
import { scanRecoverySchema, archivedScanSchema } from "../../../../../../../shared/schemas/event-scan-recovery";
import {
  enrolledEventScanRequestSchema,
  offlineScanRecordSchema,
} from "../../../../../../../shared/schemas/event-participation-scanning";
import {
  scannerDeviceSessionStatusSchema,
  SCANNER_RECOVERY_EPOCH_LIMIT,
} from "../../../../../../../shared/schemas/event-scanner-devices";
import { userAuthSessionResponseSchema } from "../../../../../../../shared/schemas/user-auth";
import { getJson } from "../../../../../../shared/api-client";
import { scannerUploadSuspended } from "../../../../../../shared/pending-user-logout";
import { scannerReceiptMatches } from "./scanner-receipt";
import type { ScannerEpoch } from "./scanner-device-ledger";
import {
  openScanStorage,
  idbRequest,
  idbCompletion,
  SCAN_STORE,
  HISTORY_STORE,
  SCANNER_EPOCH_STORE,
} from "./outbox-storage";

type Recovery = z.infer<typeof scanRecoverySchema>;
export type RecoveryImportScope = {
  eventId: string;
  operatorUserId: string;
  sessionId: string;
  sponsorId?: string;
  signal?: AbortSignal;
};
// Canonical exports have at most 100,000 bounded scan rows and 1,000 bounded epochs.
// Four KiB per row covers every optional field, including worst-case JSON string escaping.
export const CANONICAL_RECOVERY_EXPORT_BYTE_LIMIT = 100000 * 4096 + SCANNER_RECOVERY_EPOCH_LIMIT * 2048 + 4096;
const same = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const keys = Object.keys(left),
    other = Object.keys(right);
  return (
    keys.length === other.length &&
    keys.every((key) => Object.hasOwn(right, key) && same(Reflect.get(left, key), Reflect.get(right, key)))
  );
};
function reject(): never {
  throw new Error("Recovery evidence conflicts with existing records.");
}

/** Parse every record before networking or storage writes. The file conveys no authority. */
export function parseRecoveryImport(text: string, scope: RecoveryImportScope): Recovery {
  if (new TextEncoder().encode(text).byteLength > CANONICAL_RECOVERY_EXPORT_BYTE_LIMIT)
    throw new Error("Recovery file is too large.");
  const recovery = scanRecoverySchema.parse(JSON.parse(text));
  if (recovery.operatorUserId !== scope.operatorUserId || recovery.eventId !== scope.eventId)
    throw new Error("This recovery file belongs to another account or event.");
  const epochs = new Map(recovery.scannerEpochs.map((epoch) => [epoch.epochId, epoch]));
  const operations = new Map<string, unknown>(),
    sequences = new Map<string, string>(),
    receipts = new Map<string, unknown>();
  for (const record of [...recovery.pending, ...recovery.records]) {
    const scan = enrolledEventScanRequestSchema.parse(record.scan),
      epoch = epochs.get(scan.scannerSession.epochId);
    if (!epoch || epoch.deviceId !== scan.deviceId || scan.scannerSession.sequence > epoch.issuedHighWater) reject();
    const operation = operations.get(scan.operationId),
      key = JSON.stringify([scan.scannerSession.epochId, scan.scannerSession.sequence]);
    if (operation && !same(operation, scan)) reject();
    if (sequences.has(key) && sequences.get(key) !== scan.operationId) reject();
    operations.set(scan.operationId, scan);
    sequences.set(key, scan.operationId);
  }
  for (const record of recovery.records) {
    if (!scannerReceiptMatches(record.receipt, record.scan)) reject();
    const previous = receipts.get(record.scan.operationId);
    if (previous && !same(previous, record)) reject();
    receipts.set(record.scan.operationId, record);
  }
  return recovery;
}
async function requireCurrentSession(scope: RecoveryImportScope) {
  scope.signal?.throwIfAborted();
  const actor = await getJson("/api/v1/auth/session", userAuthSessionResponseSchema, { signal: scope.signal });
  if (
    actor.identity.id !== scope.operatorUserId ||
    actor.sessionId !== scope.sessionId ||
    (await scannerUploadSuspended(scope.operatorUserId, scope.sessionId))
  )
    throw new Error("Sign in with the original account before importing recovery scans.");
}

/** Checks online authority, then merges original evidence in one local transaction. Never enrolls a device. */
export async function importScanRecovery(text: string, scope: RecoveryImportScope) {
  const recovery = parseRecoveryImport(text, scope);
  if (!navigator.onLine) throw new Error("Connect to the internet to verify this recovery file.");
  await requireCurrentSession(scope);
  const verified: ScannerEpoch[] = [];
  // At most the canonical 1,000 retained epochs; sequential calls avoid a request burst.
  for (const epoch of recovery.scannerEpochs) {
    const query = scope.sponsorId ? `?${new URLSearchParams({ sponsorId: scope.sponsorId })}` : "";
    const status = await getJson(
      `/api/v1/events/${encodeURIComponent(scope.eventId)}/scanner/devices/sessions/${encodeURIComponent(epoch.epochId)}${query}`,
      scannerDeviceSessionStatusSchema,
      { signal: scope.signal ? AbortSignal.any([scope.signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000) },
    );
    if (
      status.epochId !== epoch.epochId ||
      status.deviceId !== epoch.deviceId ||
      status.enrollmentOperationId !== epoch.enrollmentOperationId ||
      status.openedAt !== epoch.openedAt
    )
      reject();
    if (status.highWaterSequence !== null && epoch.issuedHighWater > status.highWaterSequence) reject();
    if ((status.closedAt || status.closingDeclaredAt) && !status.closingOperationId) reject();
    if (epoch.closingOperationId && status.closingOperationId && epoch.closingOperationId !== status.closingOperationId)
      reject();
    verified.push({
      ...epoch,
      key: JSON.stringify([epoch.eventId, epoch.operatorUserId, epoch.deviceId, epoch.enrollmentOperationId]),
      state: status.closedAt ? "closed" : status.closingDeclaredAt ? "closing" : epoch.state,
      closingOperationId: status.closingOperationId ?? epoch.closingOperationId,
    });
  }
  await requireCurrentSession(scope);
  scope.signal?.throwIfAborted();
  return mergeScanRecovery(recovery, verified, scope.signal);
}

/** Merge verified recovery evidence atomically while retaining existing pending uploads and frozen epochs. */
async function mergeScanRecovery(recovery: Recovery, verified: ScannerEpoch[], signal?: AbortSignal) {
  const db = await openScanStorage();
  try {
    const transaction = db.transaction([SCAN_STORE, HISTORY_STORE, SCANNER_EPOCH_STORE], "readwrite"),
      done = idbCompletion(transaction);
    const abort = () => transaction.abort();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      signal?.throwIfAborted();
      const scans = transaction.objectStore(SCAN_STORE),
        history = transaction.objectStore(HISTORY_STORE),
        epochs = transaction.objectStore(SCANNER_EPOCH_STORE);
      const [localPending, localHistory, localEpochs] = await Promise.all([
        idbRequest<unknown[]>(
          scans.index("scope").getAll(IDBKeyRange.only([recovery.operatorUserId, recovery.eventId]), 100001),
        ),
        idbRequest<unknown[]>(
          history
            .index("scope")
            .getAll(
              IDBKeyRange.bound(
                [recovery.operatorUserId, recovery.eventId],
                [recovery.operatorUserId, recovery.eventId, Infinity],
              ),
              100001,
            ),
        ),
        idbRequest<ScannerEpoch[]>(
          epochs
            .index("scope")
            .getAll(IDBKeyRange.only([recovery.operatorUserId, recovery.eventId]), SCANNER_RECOVERY_EPOCH_LIMIT + 1),
        ),
      ]);
      if (
        localPending.length > 100000 ||
        localHistory.length > 100000 ||
        localEpochs.length > SCANNER_RECOVERY_EPOCH_LIMIT
      )
        throw new Error("Local recovery storage exceeds the import limit.");
      const sequences = new Map<string, string>();
      for (const value of [...localPending, ...localHistory, ...recovery.pending, ...recovery.records]) {
        const candidate = value as { eventId: unknown; scan: unknown };
        const record = offlineScanRecordSchema.parse({ eventId: candidate.eventId, scan: candidate.scan }),
          session = record.scan.scannerSession;
        if (!session) continue;
        const key = JSON.stringify([session.epochId, session.sequence]),
          previous = sequences.get(key);
        if (previous && previous !== record.scan.operationId) reject();
        sequences.set(key, record.scan.operationId);
      }
      const retained = new Set(localEpochs.map((epoch) => epoch.key));
      for (const incoming of verified) {
        const matching = localEpochs.filter((epoch) => epoch.epochId === incoming.epochId);
        for (const current of matching) {
          if (
            current.deviceId !== incoming.deviceId ||
            current.enrollmentOperationId !== incoming.enrollmentOperationId ||
            current.openedAt !== incoming.openedAt ||
            (current.closingOperationId &&
              incoming.closingOperationId &&
              current.closingOperationId !== incoming.closingOperationId)
          )
            reject();
          const state =
            current.state === "closed" || incoming.state === "closed"
              ? "closed"
              : current.state === "closing" || incoming.state === "closing"
                ? "closing"
                : current.state;
          epochs.put({
            ...current,
            state,
            closingOperationId: incoming.closingOperationId ?? current.closingOperationId,
            issuedHighWater: Math.max(current.issuedHighWater, incoming.issuedHighWater),
          });
        }
        if (!matching.length) {
          if (localEpochs.some((current) => current.key === incoming.key)) reject();
          retained.add(incoming.key);
          epochs.add(incoming);
        }
      }
      if (retained.size > SCANNER_RECOVERY_EPOCH_LIMIT) throw new Error("Scanner recovery session limit reached.");
      let queued = 0,
        archived = 0;
      for (const record of [...recovery.pending, ...recovery.records]) {
        const id = record.scan.operationId;
        const [pending, saved] = await Promise.all([
          idbRequest<unknown>(scans.get(id)),
          idbRequest<unknown>(history.get(id)),
        ]);
        if (
          pending &&
          typeof pending === "object" &&
          !same(
            offlineScanRecordSchema.parse({
              eventId: Reflect.get(pending, "eventId"),
              scan: Reflect.get(pending, "scan"),
            }),
            offlineScanRecordSchema.parse({ eventId: record.eventId, scan: record.scan }),
          )
        )
          reject();
        if (
          saved &&
          typeof saved === "object" &&
          !same(
            offlineScanRecordSchema.parse({ eventId: Reflect.get(saved, "eventId"), scan: Reflect.get(saved, "scan") }),
            offlineScanRecordSchema.parse({ eventId: record.eventId, scan: record.scan }),
          )
        )
          reject();
        if ("receipt" in record) {
          const archivedRecord = archivedScanSchema.parse(record);
          if (saved && typeof saved === "object" && !same(archivedScanSchema.parse(saved), archivedRecord)) reject();
          if (archivedRecord.expiresAt <= Date.now()) continue;
          if (!saved) {
            history.add(archivedRecord);
            archived++;
          }
        }
        if (!pending && !saved) {
          scans.add({ eventId: record.eventId, scan: record.scan, owner: null, leaseUntil: 0 });
          queued++;
        }
      }
      await done;
      return { queued, archived };
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        /* A failed request may already abort. */
      }
      await done.catch(() => {});
      throw error;
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  } finally {
    db.close();
  }
}
