import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  scannerRecoveryEpochSchema,
  SCANNER_RECOVERY_EPOCH_LIMIT,
  scannerDeviceSessionEnrollmentSchema,
  scannerDeviceSessionStatusSchema,
} from "../../assets/shared/schemas/event-scanner-devices";
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  resume: vi.fn(),
  epoch: {} as Record<string, unknown>,
  put: vi.fn(),
  archives: [] as Record<string, unknown>[],
  count: 1,
  abort: vi.fn(),
}));
vi.mock("../../assets/ts/shared/api-client", async (original) => ({
  ...(await original<typeof import("../../assets/ts/shared/api-client")>()),
  getJson: mocks.get,
  postJson: mocks.post,
}));
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/scanner/scanner-session-resumption", () => ({
  resumeScannerServerSession: mocks.resume,
}));
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/scanner/outbox-storage", () => ({
  SCANNER_EPOCH_STORE: "scanner-epochs",
  SCANNER_DEVICE_STORE: "scanner-devices",
  SCAN_STORE: "scans",
  idbRequest: async (value: unknown) => value,
  idbCompletion: async () => {},
  openScanStorage: async () => ({
    close: vi.fn(),
    transaction: () => ({
      abort: mocks.abort,
      objectStore: () => ({
        get: () => ({ ...mocks.epoch }),
        put: mocks.put,
        add: (value: Record<string, unknown>) => mocks.archives.push(value),
        index: () => ({ count: () => mocks.count }),
      }),
    }),
  }),
}));
import { ApiClientError } from "../../assets/ts/shared/api-client";
import {
  closeScannerEpoch,
  prepareScannerEpoch,
  startNextScannerEpoch,
} from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/scanner-device-ledger";
import { scannerOfflineContextSchema } from "../../assets/shared/schemas/event-scanner-offline-context";
const operator = "11111111-1111-4111-8111-111111111111",
  device = "22222222-2222-4222-8222-222222222222",
  epochId = "77777777-7777-4777-8777-777777777777",
  operationId = "44444444-4444-4444-8444-444444444444";
const status = (closedAt: string | null, closingDeclaredAt: string | null = null) =>
  scannerDeviceSessionStatusSchema.parse({
    epochId,
    deviceId: device,
    enrollmentOperationId: operationId,
    openedAt: "2026-10-04T09:00:00.000Z",
    highWaterSequence: closedAt ? 17 : null,
    receivedCount: 17,
    missingCount: closedAt ? 0 : null,
    closedAt,
    closingDeclaredAt,
    closingOperationId: closedAt || closingDeclaredAt ? operationId : null,
  });
function preparedLease() {
  const now = new Date().toISOString();
  return scannerOfflineContextSchema.parse({
    slug: "synthetic-event",
    route: "/events/synthetic-event/scanner",
    eventId: "55555555-5555-4555-8555-555555555555",
    operatorUserId: operator,
    sessionId: "66666666-6666-4666-8666-666666666666",
    deviceId: device,
    epochId,
    action: "attendance",
    occurrenceId: null,
    roomId: null,
    publishedRevision: null,
    serverNow: now,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    savedAt: now,
    lastObservedAt: now,
  });
}
beforeEach(() => {
  mocks.archives = [];
  mocks.count = 1;
  mocks.abort.mockReset();
  vi.stubGlobal("IDBKeyRange", { only: (value: unknown) => value });
  mocks.get.mockReset();
  mocks.post.mockReset();
  mocks.resume.mockReset();
  mocks.put.mockReset().mockImplementation((value) => {
    mocks.epoch = value;
  });
  mocks.epoch = {
    key: JSON.stringify(["synthetic-event", operator, device]),
    eventId: "synthetic-event",
    operatorUserId: operator,
    deviceId: device,
    epochId,
    enrollmentOperationId: operationId,
    openedAt: "2026-10-04T09:00:00.000Z",
    issuedHighWater: 17,
    state: "open",
    closingOperationId: null,
  };
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("persistent scanner preparation", () => {
  it("seals a server-closed session without resetting locally issued highwater", async () => {
    mocks.get.mockResolvedValue(status("2026-10-04T10:00:00.000Z"));
    const prepared = await prepareScannerEpoch("synthetic-event", operator, device);
    expect(prepared.state).toBe("closed");
    expect(prepared.closingOperationId).toBe(operationId);
    const { key: _, ...recovery } = prepared;
    expect(scannerRecoveryEpochSchema.safeParse(recovery).success).toBe(true);
    expect(prepared.issuedHighWater).toBe(17);
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it("freezes when the server has a closing declaration", async () => {
    mocks.get.mockResolvedValue(status(null, "2026-10-04T10:00:00.000Z"));
    const prepared = await prepareScannerEpoch("synthetic-event", operator, device);
    expect(prepared.state).toBe("closing");
    expect(prepared.issuedHighWater).toBe(17);
    expect(prepared.closingOperationId).toBeTruthy();
  });
  it("resumes the same saved epoch offline without network", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    expect((await prepareScannerEpoch("synthetic-event", operator, device)).issuedHighWater).toBe(17);
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it.each(["closed", "closing"])("keeps the saved lease when a %s session cannot be resumed", async (state) => {
    mocks.epoch = { ...mocks.epoch, collectorContext: preparedLease() };
    mocks.get.mockResolvedValue(
      status(
        state === "closed" ? new Date().toISOString() : null,
        state === "closing" ? new Date().toISOString() : null,
      ),
    );
    mocks.resume.mockRejectedValue(new Error("Unavailable"));
    const prepared = await prepareScannerEpoch("synthetic-event", operator, device);
    expect(prepared.state).toBe("open");
    expect(prepared.issuedHighWater).toBe(17);
    expect(mocks.epoch.state).toBe("open");
    expect(mocks.resume).toHaveBeenCalledOnce();
  });
  it("resumes a server-closed session with its original epoch and counter", async () => {
    mocks.epoch = { ...mocks.epoch, collectorContext: preparedLease() };
    mocks.get.mockResolvedValue(status(new Date().toISOString()));
    mocks.resume.mockResolvedValue(status(null));
    const prepared = await prepareScannerEpoch("synthetic-event", operator, device);
    expect(prepared.state).toBe("open");
    expect(prepared.issuedHighWater).toBe(17);
    expect(mocks.resume).toHaveBeenCalledWith("synthetic-event", epochId, device, undefined);
  });
  it("keeps a reopened scanner's counter when an earlier close request finishes", async () => {
    const frozen = { ...mocks.epoch, state: "closing", closingOperationId: operationId };
    mocks.epoch = frozen;
    mocks.count = 0;
    mocks.post.mockImplementation(async () => {
      mocks.epoch = { ...frozen, state: "open", closingOperationId: null, issuedHighWater: 18 };
      return status("2026-10-04T10:00:00.000Z");
    });
    await expect(closeScannerEpoch(frozen as Parameters<typeof closeScannerEpoch>[0])).rejects.toThrow(
      "changed during closing",
    );
    expect(mocks.epoch).toMatchObject({ state: "open", issuedHighWater: 18 });
    expect(mocks.put).not.toHaveBeenCalled();
    expect(mocks.abort).toHaveBeenCalledOnce();
  });
  it("closes an unchanged scanner without replacing its saved counter", async () => {
    const frozen = { ...mocks.epoch, state: "closing", closingOperationId: operationId };
    mocks.epoch = frozen;
    mocks.count = 0;
    mocks.post.mockResolvedValue(status("2026-10-04T10:00:00.000Z"));
    const closed = await closeScannerEpoch(frozen as Parameters<typeof closeScannerEpoch>[0]);
    expect(closed).toMatchObject({ state: "closed", issuedHighWater: 17 });
    expect(mocks.put).toHaveBeenCalledOnce();
    expect(mocks.abort).not.toHaveBeenCalled();
  });
  it.each([401, 403, 429, 500, 503])("keeps a prepared local lease through HTTP %s", async (httpStatus) => {
    mocks.epoch = { ...mocks.epoch, collectorContext: preparedLease() };
    mocks.get.mockRejectedValue(
      new ApiClientError({ error: { code: "SERVER_REFUSAL", message: "Unavailable" } }, httpStatus),
    );
    expect((await prepareScannerEpoch("synthetic-event", operator, device)).state).toBe("open");
    expect(mocks.put).not.toHaveBeenCalled();
  });
  it("uses saved authorization only for connectivity errors", async () => {
    mocks.get.mockRejectedValue(new ApiClientError({ error: { code: "NETWORK_UNAVAILABLE", message: "Offline" } }, 0));
    expect((await prepareScannerEpoch("synthetic-event", operator, device)).state).toBe("open");
    mocks.get.mockRejectedValue(
      new ApiClientError({ error: { code: "FORBIDDEN", message: "Permission changed" } }, 403),
    );
    await expect(prepareScannerEpoch("synthetic-event", operator, device)).rejects.toThrow("Permission changed");
    expect(mocks.epoch.issuedHighWater).toBe(17);
  });
  it("retries the persisted enrollment operation without resetting a concurrent issued counter", async () => {
    mocks.epoch = { ...mocks.epoch, state: "preparing", epochId: null, issuedHighWater: 0 };
    mocks.post.mockImplementation(async (_url, body) => {
      expect(scannerDeviceSessionEnrollmentSchema.parse(body).operationId).toBe(operationId);
      mocks.epoch = { ...mocks.epoch, state: "open", epochId, issuedHighWater: 17 };
      return {
        epochId,
        eventId: operationId,
        operatorUserId: operator,
        deviceId: device,
        openedAt: "2026-10-04T09:00:00.000Z",
      };
    });
    expect((await prepareScannerEpoch("synthetic-event", operator, device)).issuedHighWater).toBe(17);
  });
  it("archives the closed epoch and enrolls a distinct later shift with a fresh sequence", async () => {
    mocks.epoch = { ...mocks.epoch, state: "closed", closingOperationId: operationId };
    const original = { ...mocks.epoch };
    const nextEpochId = "88888888-8888-4888-8888-888888888888";
    mocks.post.mockImplementation(async (_url, body) => {
      expect(scannerDeviceSessionEnrollmentSchema.parse(body).operationId).not.toBe(operationId);
      return {
        epochId: nextEpochId,
        eventId: operationId,
        operatorUserId: operator,
        deviceId: device,
        openedAt: "2026-10-05T09:00:00.000Z",
      };
    });
    const next = await startNextScannerEpoch("synthetic-event", operator, device);
    expect(next.epochId).toBe(nextEpochId);
    expect(next.issuedHighWater).toBe(0);
    expect(next.state).toBe("open");
    expect(mocks.archives).toHaveLength(1);
    expect(mocks.archives[0]).toMatchObject({
      ...original,
      key: JSON.stringify(["synthetic-event", operator, device, operationId]),
    });
    const { key: _, ...recovery } = mocks.archives[0]!;
    expect(scannerRecoveryEpochSchema.safeParse(recovery).success).toBe(true);
  });
  it("refuses archive overflow without deleting evidence or enrolling another session", async () => {
    mocks.epoch = { ...mocks.epoch, state: "closed", closingOperationId: operationId };
    mocks.count = SCANNER_RECOVERY_EPOCH_LIMIT;
    await expect(startNextScannerEpoch("synthetic-event", operator, device)).rejects.toThrow("storage limit");
    expect(mocks.archives).toHaveLength(0);
    expect(mocks.put).not.toHaveBeenCalled();
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.abort).toHaveBeenCalledOnce();
  });
});
