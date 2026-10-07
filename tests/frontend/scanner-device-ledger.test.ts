import { scanRecoverySchema } from "../../assets/shared/schemas/event-scan-recovery";
import { describe, expect, it, vi } from "vitest";
import { sequenceScannerRecord } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/scanner-device-ledger";
import { scannerReceiptMatches } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/scanner-receipt";
import {
  eventScanRequestSchema,
  eventScanResponseSchema,
} from "../../assets/shared/schemas/event-participation-scanning";
const epochId = "77777777-7777-4777-8777-777777777777";
const scan = eventScanRequestSchema.parse({
  operatorUserId: "11111111-1111-4111-8111-111111111111",
  deviceId: "22222222-2222-4222-8222-222222222222",
  badgeId: "ABCDEFGHJKLMNPQR",
  operationId: "44444444-4444-4444-8444-444444444444",
  occurrenceId: null,
  action: "check",
  observedAt: "2026-10-04T09:00:00.000Z",
});
function transaction(state: "open" | "closing" | "closed", issuedHighWater = 0) {
  const put = vi.fn(),
    abort = vi.fn();
  const epoch = { epochId, state, issuedHighWater };
  const store = {
    put,
    get: vi.fn(() => {
      const request = { result: epoch, onsuccess: null as (() => void) | null };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    }),
  };
  return { value: { objectStore: () => store, abort } as unknown as IDBTransaction, put, abort };
}
describe("scanner sequence ownership", () => {
  it("increments persisted highwater in the caller's queue transaction", async () => {
    const tx = transaction("open", 41);
    const result = await sequenceScannerRecord(tx.value, { eventId: "synthetic-event", scan });
    expect(result.scan.scannerSession).toEqual({ epochId, sequence: 42 });
    expect(tx.put).toHaveBeenCalledWith(expect.objectContaining({ issuedHighWater: 42 }));
    expect(tx.abort).not.toHaveBeenCalled();
  });
  it.each(["closing", "closed"] as const)("aborts queue writes after %s", async (state) => {
    const tx = transaction(state, 41);
    await expect(sequenceScannerRecord(tx.value, { eventId: "synthetic-event", scan })).rejects.toThrow(
      "Prepare an open",
    );
    expect(tx.abort).toHaveBeenCalledOnce();
    expect(tx.put).not.toHaveBeenCalled();
  });
  it("aborts malformed allocated payloads before changing highwater", async () => {
    const tx = transaction("open", 41);
    await expect(
      sequenceScannerRecord(tx.value, { eventId: "synthetic-event", scan: { ...scan, badgeId: "invalid" } }),
    ).rejects.toThrow();
    expect(tx.abort).toHaveBeenCalledOnce();
    expect(tx.put).not.toHaveBeenCalled();
  });
  it("requires exact durable receipt coverage even for a denied business outcome", () => {
    const queued = { ...scan, scannerSession: { epochId, sequence: 42 } };
    const receipt = eventScanResponseSchema.parse({
      operationId: scan.operationId,
      outcome: "denied",
      reason: "capacity",
      recorded: false,
      attendanceRecorded: false,
      scannerReceipt: { epochId, sequence: 42, operationId: scan.operationId, receivedAt: "2026-10-04T09:01:00.000Z" },
    });
    expect(scannerReceiptMatches(receipt, queued)).toBe(true);
    expect(scannerReceiptMatches({ ...receipt, scannerReceipt: undefined }, queued)).toBe(false);
    expect(scannerReceiptMatches(receipt, { ...queued, scannerSession: { epochId, sequence: 43 } })).toBe(false);
    expect(scannerReceiptMatches(receipt, { ...queued, operationId: scan.badgeId })).toBe(false);
  });
  it("exports enrolled scanners with zero operations and rejects mixed-owner epochs", () => {
    const epoch = {
      eventId: "synthetic-event",
      operatorUserId: scan.operatorUserId,
      deviceId: scan.deviceId,
      enrollmentOperationId: scan.operationId,
      epochId,
      openedAt: "2026-10-04T09:00:00.000Z",
      issuedHighWater: 0,
      state: "open",
      closingOperationId: null,
    };
    const snapshot = {
      version: 1,
      operatorUserId: scan.operatorUserId,
      eventId: "synthetic-event",
      exportedAt: "2026-10-04T09:01:00.000Z",
      records: [],
      pending: [],
      scannerEpochs: [epoch],
    };
    expect(scanRecoverySchema.parse(snapshot).scannerEpochs).toHaveLength(1);
    expect(
      scanRecoverySchema.safeParse({ ...snapshot, scannerEpochs: [{ ...epoch, operatorUserId: scan.deviceId }] })
        .success,
    ).toBe(false);
  });
});
