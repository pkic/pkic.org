import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eventScanRequestSchema } from "../../assets/shared/schemas/event-participation-scanning";
import { persistScannerCapture } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/useScannerFailureCapture";
import { boundedScannedValue } from "../../assets/shared/schemas/scanner-attempt-capture";
import { scannerQueueRecordSchema } from "../../assets/shared/schemas/event-scanner-offline-queue";
const mocks = vi.hoisted(() => ({ open: vi.fn(), suspended: vi.fn(async () => false), active: vi.fn() }));
vi.mock("../../assets/ts/shared/pending-user-logout", () => ({
  scannerUploadSuspended: mocks.suspended,
  readActiveUserSession: mocks.active,
}));
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/scanner/outbox-storage", async (original) => ({
  ...(await original<object>()),
  openScanStorage: mocks.open,
}));
import {
  queueScannerAttempt,
  drainScanOutbox,
} from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/scan-outbox";
import { retainedEarlierScannerData } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/scan-history";
import { recentPendingScans } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/scanner-recent-scans";
const operator = "11111111-1111-4111-8111-111111111111",
  device = "22222222-2222-4222-8222-222222222222",
  epoch = "33333333-3333-4333-8333-333333333333";
type Row = Record<string, unknown>;
let rows: Map<string, Row>, history: Map<string, Row>, highWater: number;
function storage(): IDBDatabase {
  return {
    close() {},
    transaction() {
      let timer: ReturnType<typeof setTimeout>;
      const tx = {
        oncomplete: null as (() => void) | null,
        onabort: null as (() => void) | null,
        abort() {
          clearTimeout(timer);
          queueMicrotask(() => tx.onabort?.());
        },
        objectStore(name: string) {
          const records = name === "history" ? history : rows;
          function request<T>(fn: () => T) {
            clearTimeout(timer);
            const req = { result: undefined as T | undefined, onsuccess: null as (() => void) | null };
            queueMicrotask(() => {
              req.result = fn();
              req.onsuccess?.();
            });
            timer = setTimeout(() => tx.oncomplete?.(), 0);
            return req;
          }
          function cursor(values = [...records.values()]) {
            let position = 0;
            const req = request(() => next());
            function next(): unknown {
              const value = values[position++];
              return value
                ? {
                    value,
                    update: (row: Row) =>
                      request(() => records.set(String((row.scan as Row).operationId), structuredClone(row))),
                    delete: () => request(() => records.delete(String((value.scan as Row).operationId))),
                    continue() {
                      queueMicrotask(() => {
                        req.result = next();
                        req.onsuccess?.();
                      });
                    },
                  }
                : null;
            }
            return req;
          }
          return {
            get: (id: string) =>
              request(() =>
                name === "scanner-epochs"
                  ? { state: "open", epochId: epoch, issuedHighWater: highWater }
                  : records.get(id),
              ),
            getAll: () => request(() => [...records.values()]),
            delete: (id: string) => request(() => records.delete(id)),
            openCursor: () => cursor(),
            put: (row: Row) => {
              if (name === "scanner-epochs") highWater = Number(row.issuedHighWater);
              else request(() => records.set(String((row.scan as Row).operationId), structuredClone(row)));
            },
            add: (row: Row) =>
              request(() => {
                const id = String((row.scan as Row).operationId);
                if (rows.has(id)) throw new Error("Duplicate operation");
                rows.set(id, structuredClone(row));
              }),
            index: (indexName: string) => ({
              count: (scope: string[]) =>
                request(
                  () =>
                    [...rows.values()].filter(
                      (row) => (row.scan as Row).operatorUserId === scope[0] && row.eventId === scope[1],
                    ).length,
                ),
              openCursor: (scope: string[]) =>
                cursor(
                  indexName === "expiry"
                    ? [...records.values()].filter((row) => Number(row.expiresAt) <= Date.now())
                    : [...records.values()].filter(
                        (row) => (row.scan as Row).operatorUserId === scope[0] && row.eventId === scope[1],
                      ),
                ),
            }),
          };
        },
      };
      return tx;
    },
  } as unknown as IDBDatabase;
}
beforeEach(() => {
  rows = new Map();
  history = new Map();
  mocks.active.mockResolvedValue({ operatorUserId: operator, sessionId: "active" });
  highWater = 0;
  mocks.open.mockImplementation(async () => storage());
  vi.stubGlobal("IDBKeyRange", {
    bound: (lower: string[]) => lower.slice(0, 2),
    only: (scope: string[]) => scope,
    upperBound: (value: number) => value,
  });
});
afterEach(() => vi.unstubAllGlobals());
function failure(raw = "  not-a-badge 😀  ") {
  return {
    kind: "failure" as const,
    eventId: "synthetic-event",
    scan: {
      ...boundedScannedValue(raw),
      operatorUserId: operator,
      deviceId: device,
      operationId: crypto.randomUUID(),
      occurrenceId: null,
      roomId: null,
      action: "attendance" as const,
      observedAt: "2026-10-12T10:00:00.000Z",
      reason: "unsupported_code" as const,
    },
  };
}
describe("durable rejected scanner attempts", () => {
  it("retains the exact raw prefix and epoch sequence after closing and reopening storage", async () => {
    const captured = failure(" " + "😀".repeat(64) + " tail ");
    const queued = await queueScannerAttempt(captured);
    expect(queued.kind).toBe("failure");
    expect(queued.scan.scannerSession).toEqual({ epochId: epoch, sequence: 1 });
    expect(queued.scan.scannedValueTruncated).toBe(true);
    expect([...queued.scan.scannedValue]).toHaveLength(64);
    const recent = await recentPendingScans(operator, "synthetic-event");
    expect(recent.total).toBe(1);
    expect(recent.records).toEqual([queued]);
    expect(await recentPendingScans(device, "synthetic-event")).toEqual({ records: [], total: 0 });
    expect("badgeId" in queued.scan).toBe(false);
  });
  it("keeps all unacknowledged operations beyond the bounded display page", async () => {
    for (let count = 0; count < 25; count++) await queueScannerAttempt(failure());
    expect(highWater).toBe(25);
    expect(rows.size).toBe(25);
    const recent = await recentPendingScans(operator, "synthetic-event");
    expect(recent.total).toBe(25);
    expect(recent.records).toHaveLength(20);
    expect(recent.records.every((row) => scannerQueueRecordSchema.safeParse(row).success)).toBe(true);
  });
  it("exports only untouched unsupported earlier records for the selected operator and event", async () => {
    const earlier = {
      eventId: "synthetic-event",
      scan: { operatorUserId: operator, operationId: "earlier", badgeId: "original-code" },
      owner: null,
      leaseUntil: 0,
    };
    rows.set("earlier", earlier);
    rows.set("another-owner", { ...earlier, scan: { ...earlier.scan, operatorUserId: device } });
    await queueScannerAttempt(failure());
    expect(await retainedEarlierScannerData(operator, "synthetic-event")).toEqual([earlier]);
    expect(rows.get("earlier")).toEqual(earlier);
    expect(rows.size).toBe(3);
  });
  it("requires the exact immutable acknowledgment before archiving and deleting a failed attempt", async () => {
    const queued = await queueScannerAttempt(failure());
    const response = {
      operationId: queued.scan.operationId,
      outcome: "unknown",
      reason: "unsupported_code",
      recorded: true,
      attendanceRecorded: false,
      admissionRecorded: false,
      checkoutRecorded: false,
      scannerReceipt: {
        ...queued.scan.scannerSession!,
        operationId: queued.scan.operationId,
        receivedAt: "2026-10-12T10:01:00.000Z",
      },
    };
    const upload = vi.fn(async () =>
      Response.json({ ...response, scannerReceipt: { ...response.scannerReceipt, sequence: 99 } }),
    );
    expect((await drainScanOutbox(upload, operator)).state).toBe("retry");
    expect(rows.size).toBe(1);
    expect(history.size).toBe(0);
    rows.set(queued.scan.operationId, { ...rows.get(queued.scan.operationId)!, nextAttemptAt: 0 });
    upload.mockImplementation(async () => Response.json(response));
    expect(await drainScanOutbox(upload, operator)).toEqual({ uploaded: 1, state: "complete" });
    expect(rows.size).toBe(0);
    expect(history.get(queued.scan.operationId)).toMatchObject({ ...queued, receipt: response });
    expect(await drainScanOutbox(upload, operator)).toEqual({ uploaded: 0, state: "complete" });
    expect(highWater).toBe(1);
  });
  it("retains earlier unsupported payloads without uploading or inventing capture evidence", async () => {
    const earlier = {
      eventId: "synthetic-event",
      scan: { operatorUserId: operator, operationId: "earlier", badgeId: "original-code" },
      owner: null,
      leaseUntil: 0,
    };
    rows.set("earlier", earlier);
    const upload = vi.fn();
    expect((await drainScanOutbox(upload, operator)).state).toBe("recovery_required");
    expect(upload).not.toHaveBeenCalled();
    expect(rows.get("earlier")?.scan).toEqual(earlier.scan);
    expect(await retainedEarlierScannerData(operator, "synthetic-event")).toHaveLength(1);
    expect(history.size).toBe(0);
  });
  it("does not write a contradictory failure audit after the normal operation is retained", async () => {
    const attempt = failure();
    const capture = { ...attempt.scan };
    Reflect.deleteProperty(capture, "reason");
    const scan = eventScanRequestSchema.parse({ ...capture, badgeId: "ABCDEFGHJKLMNPQR" });
    rows.set(scan.operationId, { eventId: attempt.eventId, kind: "scan", scan });
    const audit = vi.fn(async () => true);
    await expect(
      persistScannerCapture(
        scan,
        attempt.eventId,
        async () => {
          throw new Error("Save result interrupted");
        },
        audit,
      ),
    ).rejects.toThrow("already retained");
    expect(audit).not.toHaveBeenCalled();
    expect(rows.size).toBe(1);
  });
  it("does not claim persistence when storage is unavailable", async () => {
    mocks.open.mockRejectedValue(new Error("Quota exceeded"));
    await expect(queueScannerAttempt(failure())).rejects.toThrow("Quota exceeded");
    expect(highWater).toBe(0);
    expect(rows.size).toBe(0);
  });
});
