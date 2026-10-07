import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { offlineScanRecordSchema } from "../../assets/shared/schemas/event-participation-scanning";
import { scanRecoverySchema } from "../../assets/shared/schemas/event-scan-recovery";
import { scannerDeviceSessionStatusSchema } from "../../assets/shared/schemas/event-scanner-devices";
import { userAuthSessionResponseSchema } from "../../assets/shared/schemas/user-auth";
const mocks = vi.hoisted(() => ({ get: vi.fn(), suspended: vi.fn(), open: vi.fn() }));
vi.mock("../../assets/ts/shared/api-client", () => ({ getJson: mocks.get }));
vi.mock("../../assets/ts/shared/pending-user-logout", () => ({ scannerUploadSuspended: mocks.suspended }));
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/scanner/outbox-storage", async (original) => ({
  ...(await original<object>()),
  openScanStorage: mocks.open,
}));
import {
  importScanRecovery,
  CANONICAL_RECOVERY_EXPORT_BYTE_LIMIT,
} from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/scan-recovery-import";
import { lastSuccessfulScanSync } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/scan-history";
const id = (digit: string) =>
  `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
const scope = { operatorUserId: id("1"), eventId: "synthetic-event", sessionId: id("8") };
const epoch = {
  eventId: scope.eventId,
  operatorUserId: scope.operatorUserId,
  deviceId: id("2"),
  epochId: id("7"),
  enrollmentOperationId: id("6"),
  openedAt: "2026-10-04T09:00:00.000Z",
  issuedHighWater: 2,
  state: "open" as const,
  closingOperationId: null,
};
const pending = offlineScanRecordSchema.parse({
  eventId: scope.eventId,
  scan: {
    operatorUserId: scope.operatorUserId,
    deviceId: epoch.deviceId,
    badgeId: "ABCDEFGHJKLMNPQR",
    operationId: id("4"),
    occurrenceId: null,
    action: "check",
    observedAt: "2026-09-01T09:01:00.000Z",
    scannerSession: { epochId: epoch.epochId, sequence: 1 },
  },
});
function backup() {
  return scanRecoverySchema.parse({
    version: 1,
    operatorUserId: scope.operatorUserId,
    eventId: scope.eventId,
    exportedAt: "2026-10-04T09:02:00.000Z",
    pending: [pending],
    records: [],
    scannerEpochs: [epoch],
  });
}
// Transactional request fixture: writes remain private until complete, and abort discards all writes.
// Browser coverage separately exercises native IndexedDB; this fixture exercises the actual merge/request code.
type Row = Record<string, unknown>;
let tables: Map<string, Map<string, Row>>;
function storage() {
  return {
    close() {},
    transaction(stores: string[] | string) {
      const names = typeof stores === "string" ? [stores] : stores;
      const staged = new Map(names.map((name) => [name, new Map(tables.get(name))]));
      let timer: ReturnType<typeof setTimeout> | undefined,
        aborted = false;
      const tx = {
        oncomplete: null as (() => void) | null,
        onabort: null as (() => void) | null,
        error: null,
        abort() {
          aborted = true;
          clearTimeout(timer);
          queueMicrotask(() => tx.onabort?.());
        },
        objectStore(name: string) {
          const rows = staged.get(name)!;
          function request<T>(work: () => T) {
            clearTimeout(timer);
            const req = {
              result: undefined as T | undefined,
              onsuccess: null as (() => void) | null,
              onerror: null,
              error: null,
            };
            queueMicrotask(() => {
              if (aborted) return;
              req.result = work();
              req.onsuccess?.();
            });
            timer = setTimeout(() => {
              if (aborted) return;
              for (const [key, values] of staged) tables.set(key, values);
              tx.oncomplete?.();
            }, 0);
            return req;
          }
          const key = (row: Row) =>
            name === "scanner-epochs" ? String(row.key) : String((row.scan as Row).operationId);
          return {
            get: (id: string) => request(() => rows.get(id)),
            add: (row: Row) =>
              request(() => {
                rows.set(key(row), structuredClone(row));
              }),
            put: (row: Row) =>
              request(() => {
                rows.set(key(row), structuredClone(row));
              }),
            index: () => ({
              getAll: () => request(() => Array.from(rows.values())),
              openCursor: (range: unknown, direction: string) =>
                request(() => {
                  const [lower, upper] = range as [[string, string, number], [string, string, number]];
                  const candidates = Array.from(rows.values())
                    .filter((row) => {
                      const scan = row.scan as Row;
                      return (
                        scan.operatorUserId === lower[0] &&
                        row.eventId === lower[1] &&
                        Number(row.acknowledgedAt) > lower[2] &&
                        Number(row.acknowledgedAt) <= upper[2]
                      );
                    })
                    .sort((a, b) => Number(a.acknowledgedAt) - Number(b.acknowledgedAt));
                  const value = direction === "prev" ? candidates.at(-1) : candidates[0];
                  return value ? { value } : null;
                }),
            }),
          };
        },
      };
      return tx;
    },
  } as unknown as IDBDatabase;
}
const status = () =>
  scannerDeviceSessionStatusSchema.parse({
    epochId: epoch.epochId,
    deviceId: epoch.deviceId,
    enrollmentOperationId: epoch.enrollmentOperationId,
    openedAt: epoch.openedAt,
    highWaterSequence: null,
    receivedCount: 0,
    missingCount: null,
    closingDeclaredAt: null,
    closedAt: null,
    closingOperationId: null,
  });
beforeEach(() => {
  tables = new Map(["scans", "history", "scanner-epochs", "scanner-devices"].map((name) => [name, new Map()]));
  mocks.open.mockImplementation(async () => storage());
  mocks.suspended.mockResolvedValue(false);
  mocks.get.mockImplementation(async (url: string) =>
    url === "/api/v1/auth/session"
      ? userAuthSessionResponseSchema.parse({
          success: true,
          sessionId: scope.sessionId,
          identity: { id: scope.operatorUserId, email: "synthetic@example.test" },
          eventParticipation: true,
          expiresAt: "2026-10-06T09:00:00.000Z",
          idleExpiresAt: "2026-10-06T09:00:00.000Z",
        })
      : status(),
  );
  vi.stubGlobal("IDBKeyRange", {
    only: (value: unknown) => value,
    bound: (lower: unknown, upper: unknown) => [lower, upper],
  });
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
const importBackup = (value = backup()) => importScanRecovery(JSON.stringify(value), scope);
describe("downloaded scanner recovery import", () => {
  it("keeps the byte envelope above the canonical maximum exported row and epoch population", () => {
    const eventId = "\u0000".repeat(200),
      maximum = Number.MAX_SAFE_INTEGER;
    const scan = {
      ...pending.scan,
      occurrenceId: id("9"),
      roomId: id("9"),
      action: "exception",
      exceptionReason: "registration_correction",
      recordAttendance: true,
      sponsorId: id("9"),
      consentConfirmed: true,
      capturePublicationRevision: maximum,
      offlineRight: { grantId: id("9"), activationId: id("9"), slot: maximum },
    };
    const row = {
      eventId,
      scan,
      receipt: {
        operationId: scan.operationId,
        outcome: "denied",
        reason: "contact_retention_expired",
        recorded: false,
        attendanceRecorded: false,
        checkoutRecorded: true,
        admissionRecorded: true,
        scannerReceipt: { ...scan.scannerSession!, operationId: scan.operationId, receivedAt: epoch.openedAt },
      },
      acknowledgedAt: maximum - 14 * 86400000,
      expiresAt: maximum,
    };
    const longest = scanRecoverySchema.parse({
      ...backup(),
      eventId,
      pending: [],
      records: [row],
      scannerEpochs: [{ ...epoch, eventId, issuedHighWater: maximum, state: "closed", closingOperationId: id("9") }],
    });
    const rowBytes = new TextEncoder().encode(JSON.stringify(longest.records[0])).byteLength;
    const epochBytes = new TextEncoder().encode(JSON.stringify(longest.scannerEpochs[0])).byteLength;
    const contextual = scanRecoverySchema.parse({
      ...longest,
      records: [
        {
          ...row,
          scan: {
            ...scan,
            offlineRight: undefined,
            occurrenceId: null,
            roomId: undefined,
            capturePublicationRevision: null,
            nativeEventContext: { profileKey: "board_meeting", timeZone: "America/Argentina/ComodRivadavia" },
          },
        },
      ],
    });
    const contextBytes = new TextEncoder().encode(JSON.stringify(contextual.records[0])).byteLength;
    // The timezone contract allows 100 characters; six bytes each also covers every JSON escape.
    expect(Math.max(rowBytes, contextBytes) + 600 + 1).toBeLessThan(4096);
    expect(epochBytes + 1).toBeLessThan(2048);
    expect(100000 * (rowBytes + 1) + 1000 * (epochBytes + 1) + 4096).toBeLessThan(CANONICAL_RECOVERY_EXPORT_BYTE_LIMIT);
  });
  it("queues old pending bodies unchanged and imports recovery-only epochs idempotently without replacing capture device", async () => {
    tables
      .get("scanner-devices")!
      .set(scope.operatorUserId, { operatorUserId: scope.operatorUserId, deviceId: id("9") });
    expect(await importBackup()).toEqual({ queued: 1, archived: 0 });
    expect(await importBackup()).toEqual({ queued: 0, archived: 0 });
    expect(tables.get("scans")!.get(pending.scan.operationId)).toEqual({ ...pending, owner: null, leaseUntil: 0 });
    expect(tables.get("scanner-devices")!.get(scope.operatorUserId)?.deviceId).toBe(id("9"));
    expect([...tables.get("scanner-epochs")!.keys()]).toEqual([
      JSON.stringify([scope.eventId, scope.operatorUserId, epoch.deviceId, epoch.enrollmentOperationId]),
    ]);
    expect(mocks.get).toHaveBeenCalledWith(
      expect.stringContaining(`/sessions/${epoch.epochId}`),
      scannerDeviceSessionStatusSchema,
      expect.any(Object),
    );
  });
  it("reads only the latest retained acknowledgment for the selected owner and event, not pending or other accounts", async () => {
    const acknowledgedAt = Date.now() - 1000;
    const row = {
      ...pending,
      receipt: {
        operationId: pending.scan.operationId,
        outcome: "unknown",
        reason: "unknown_credential",
        recorded: false,
        attendanceRecorded: false,
        scannerReceipt: {
          ...pending.scan.scannerSession!,
          operationId: pending.scan.operationId,
          receivedAt: epoch.openedAt,
        },
      },
      acknowledgedAt,
      expiresAt: acknowledgedAt + 14 * 86400000,
    };
    tables.get("history")!.set(pending.scan.operationId, row);
    tables.get("history")!.set(id("5"), { ...row, eventId: "other-event", acknowledgedAt: acknowledgedAt + 500 });
    tables
      .get("history")!
      .set(id("9"), { ...row, scan: { ...row.scan, operatorUserId: id("9") }, acknowledgedAt: acknowledgedAt + 500 });
    expect(await lastSuccessfulScanSync(scope.operatorUserId, scope.eventId)).toBe(
      new Date(acknowledgedAt).toISOString(),
    );
    expect(await lastSuccessfulScanSync(id("6"), scope.eventId)).toBeNull();
    tables.get("history")!.clear();
    tables.get("scans")!.set(pending.scan.operationId, pending);
    expect(await lastSuccessfulScanSync(scope.operatorUserId, scope.eventId)).toBeNull();
    const old = Date.now() - 15 * 86400000;
    tables
      .get("history")!
      .set(pending.scan.operationId, { ...row, acknowledgedAt: old, expiresAt: old + 14 * 86400000 });
    expect(await lastSuccessfulScanSync(scope.operatorUserId, scope.eventId)).toBeNull();
  });
  it("preserves native calendar and publication context in the original replay body", async () => {
    const contextual = offlineScanRecordSchema.parse({
      ...pending,
      scan: {
        ...pending.scan,
        capturePublicationRevision: null,
        nativeEventContext: { profileKey: "board_meeting", timeZone: "Europe/Amsterdam" },
      },
    });
    expect(await importBackup({ ...backup(), pending: [contextual] })).toEqual({ queued: 1, archived: 0 });
    expect(tables.get("scans")!.get(pending.scan.operationId)?.scan).toEqual(contextual.scan);
  });
  it("rejects personal fields, wrong owner, missing epoch and conflicting duplicate sequence before any writes", async () => {
    const original = backup();
    for (const invalid of [
      { ...original, email: "private@example.test" },
      { ...original, pending: [{ ...pending, scan: { ...pending.scan, email: "private@example.test" } }] },
      { ...original, operatorUserId: id("9") },
      { ...original, scannerEpochs: [] },
      { ...original, pending: [pending, { ...pending, scan: { ...pending.scan, operationId: id("5") } }] },
    ]) {
      await expect(importScanRecovery(JSON.stringify(invalid), scope)).rejects.toThrow();
    }
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it("refuses offline, suspended logout, mismatched device and changed authenticated session without writes", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    await expect(importBackup()).rejects.toThrow("Connect");
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    mocks.suspended.mockResolvedValue(true);
    await expect(importBackup()).rejects.toThrow("Sign in");
    mocks.suspended.mockResolvedValue(false);
    mocks.get
      .mockImplementationOnce(async () => ({ identity: { id: scope.operatorUserId }, sessionId: scope.sessionId }))
      .mockImplementationOnce(async () => ({ ...status(), deviceId: id("9") }));
    await expect(importBackup()).rejects.toThrow("conflicts");
    mocks.get
      .mockImplementationOnce(async () => ({ identity: { id: scope.operatorUserId }, sessionId: scope.sessionId }))
      .mockImplementationOnce(async () => status())
      .mockImplementationOnce(async () => ({ identity: { id: scope.operatorUserId }, sessionId: id("9") }));
    await expect(importBackup()).rejects.toThrow("Sign in");
    expect(mocks.open).not.toHaveBeenCalled();
  });
  it("aborts earlier epoch and scan writes when a later existing operation body conflicts", async () => {
    const extra = {
      ...pending,
      scan: { ...pending.scan, operationId: id("5"), scannerSession: { epochId: epoch.epochId, sequence: 2 } },
    };
    tables.get("scans")!.set(extra.scan.operationId, {
      ...extra,
      scan: { ...extra.scan, badgeId: "23456789ABCDEFGH" },
      owner: null,
      leaseUntil: 0,
    });
    const before = structuredClone(tables);
    await expect(importBackup({ ...backup(), pending: [pending, extra] })).rejects.toThrow("conflicts");
    expect(tables).toEqual(before);
  });
  it("aborts a reused sequence owned by another operation and a cross-event operation collision", async () => {
    tables
      .get("scans")!
      .set(id("5"), { ...pending, scan: { ...pending.scan, operationId: id("5") }, owner: null, leaseUntil: 0 });
    const before = structuredClone(tables);
    await expect(importBackup()).rejects.toThrow("conflicts");
    expect(tables).toEqual(before);
    tables.get("scans")!.clear();
    tables
      .get("scans")!
      .set(pending.scan.operationId, { ...pending, eventId: "other-event", owner: null, leaseUntil: 0 });
    await expect(importBackup()).rejects.toThrow("conflicts");
    expect(tables.get("scanner-epochs")!.size).toBe(0);
  });
  it("rejects a cancelled account or view before opening a transaction", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      importScanRecovery(JSON.stringify(backup()), { ...scope, signal: controller.signal }),
    ).rejects.toThrow();
    expect(mocks.open).not.toHaveBeenCalled();
  });
  it("does not lower existing high water or reopen a closed epoch", async () => {
    const key = JSON.stringify([scope.eventId, scope.operatorUserId, epoch.deviceId]);
    tables
      .get("scanner-epochs")!
      .set(key, { ...epoch, key, issuedHighWater: 99, state: "closed", closingOperationId: id("5") });
    await importBackup();
    expect(tables.get("scanner-epochs")!.get(key)).toMatchObject({
      state: "closed",
      issuedHighWater: 99,
      closingOperationId: id("5"),
    });
  });
  it("accepts exact closed-epoch receipts, preserves acknowledgment age and skips expired history without expiring pending", async () => {
    const onlineStatus = mocks.get.getMockImplementation()!;
    mocks.get.mockImplementation(async (url: string) =>
      url === "/api/v1/auth/session"
        ? onlineStatus(url)
        : scannerDeviceSessionStatusSchema.parse({
            ...status(),
            highWaterSequence: 2,
            receivedCount: 2,
            missingCount: 0,
            closedAt: "2026-10-04T10:00:00.000Z",
            closingDeclaredAt: "2026-10-04T09:59:00.000Z",
            closingOperationId: id("5"),
          }),
    );
    const acknowledgedAt = Date.now() - 1000;
    const record = {
      ...pending,
      receipt: {
        operationId: pending.scan.operationId,
        outcome: "unknown",
        reason: "unknown_credential",
        recorded: false,
        attendanceRecorded: false,
        scannerReceipt: {
          ...pending.scan.scannerSession,
          operationId: pending.scan.operationId,
          receivedAt: epoch.openedAt,
        },
      },
      acknowledgedAt,
      expiresAt: acknowledgedAt + 14 * 86400000,
    };
    const value = scanRecoverySchema.parse({ ...backup(), records: [record], pending: [] });
    expect(await importBackup(value)).toEqual({ queued: 1, archived: 1 });
    expect(tables.get("history")!.get(pending.scan.operationId)).toEqual(value.records[0]);
    expect([...tables.get("scanner-epochs")!.values()][0]).toMatchObject({
      state: "closed",
      closingOperationId: id("5"),
    });
    expect(await importBackup(value)).toEqual({ queued: 0, archived: 0 });
    const beforeConflict = structuredClone(tables);
    await expect(
      importBackup({
        ...value,
        records: [
          {
            ...value.records[0]!,
            receipt: { ...value.records[0]!.receipt, outcome: "denied", reason: "revoked_badge" },
          },
        ],
      }),
    ).rejects.toThrow("conflicts");
    expect(tables).toEqual(beforeConflict);
    const expiredAt = Date.now() - 15 * 86400000;
    const other = {
      ...record,
      scan: { ...pending.scan, operationId: id("5"), scannerSession: { epochId: epoch.epochId, sequence: 2 } },
      receipt: {
        ...record.receipt,
        operationId: id("5"),
        scannerReceipt: { ...record.receipt.scannerReceipt, operationId: id("5"), sequence: 2 },
      },
      acknowledgedAt: expiredAt,
      expiresAt: expiredAt + 14 * 86400000,
    };
    expect(await importBackup(scanRecoverySchema.parse({ ...backup(), records: [other] }))).toEqual({
      queued: 0,
      archived: 0,
    });
    expect(tables.get("history")!.has(id("5"))).toBe(false);
  });
});
