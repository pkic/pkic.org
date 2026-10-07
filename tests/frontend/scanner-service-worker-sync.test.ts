// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  enrolledEventScanRequestSchema,
  type OfflineScanRecord,
} from "../../assets/shared/schemas/event-participation-scanning";
const mocks = vi.hoisted(() => ({ drain: vi.fn(), active: vi.fn(), suspended: vi.fn() }));
vi.mock("../../assets/ts/shared/pending-user-logout", () => ({
  readActiveUserSession: mocks.active,
  scannerUploadSuspended: mocks.suspended,
}));
import { portalSessionFixture } from "../helpers/portal-session";
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/scanner/scan-outbox", () => ({
  drainScanOutbox: mocks.drain,
}));
type SyncEvent = { tag: string; waitUntil(promise: Promise<unknown>): void };
let listeners: Map<string, (event: SyncEvent) => void>;
let messages: ReturnType<typeof vi.fn>;
let sessionFetcher: ReturnType<typeof vi.fn<(url: string, options: RequestInit) => Promise<Response>>>;
let fetcher: ReturnType<typeof vi.fn<(url: string, options: RequestInit) => Promise<Response>>>;
const record: OfflineScanRecord = {
  eventId: "00000000000000000000000000000001",
  scan: {
    scannerSession: { epochId: "00000000000000000000000000000006", sequence: 1 },
    operatorUserId: "00000000000000000000000000000002",
    operationId: "00000000000000000000000000000003",
    deviceId: "00000000000000000000000000000004",
    badgeId: "ABCDEFGHJKLMNPQR",
    occurrenceId: null,
    action: "attendance",
    observedAt: "2026-10-04T12:00:00.000Z",
  },
};
const receipt = {
  scannerReceipt: {
    epochId: "00000000000000000000000000000006",
    sequence: 1,
    operationId: "00000000000000000000000000000003",
    receivedAt: "2026-10-04T12:01:00.000Z",
  },
  operationId: "00000000000000000000000000000003",
  outcome: "eligible",
  reason: "eligible",
  recorded: true,
  attendanceRecorded: true,
};
beforeEach(async () => {
  vi.resetModules();
  mocks.drain.mockReset();
  mocks.active.mockResolvedValue({
    sessionId: "00000000-0000-4000-8000-000000000004",
    operatorUserId: record.scan.operatorUserId,
  });
  mocks.suspended.mockResolvedValue(false);
  listeners = new Map();
  messages = vi.fn();
  fetcher = vi.fn(async () => Response.json(receipt));
  const session = {
    ...portalSessionFixture({}),
    eventParticipation: true,
    identity: { id: record.scan.operatorUserId, email: "scanner@example.test" },
  };
  sessionFetcher = vi.fn(async () => Response.json(session));
  vi.stubGlobal("fetch", (url: string, options: RequestInit) =>
    url === "/api/v1/auth/session" ? sessionFetcher(url, options) : fetcher(url, options),
  );
  vi.stubGlobal("self", {
    location: { origin: "https://pkic.example" },
    clients: { claim: vi.fn(), matchAll: vi.fn(async () => [{ postMessage: messages }]) },
    addEventListener: (type: string, listener: (event: SyncEvent) => void) => listeners.set(type, listener),
  });
  await import("../../assets/ts/member-flows/portal/sections/events/detail/scanner/scanner-service-worker");
});
afterEach(() => vi.unstubAllGlobals());
function sync(tag = "pkic-scanner-upload") {
  const waitUntil = vi.fn();
  listeners.get("sync")!({ tag, waitUntil });
  return waitUntil;
}
describe("bounded scanner background synchronization", () => {
  it("delivers verified receipts and reports completion after one drain", async () => {
    mocks.drain.mockImplementation(async (upload: (row: OfflineScanRecord) => Promise<Response>) => {
      await upload(record);
      return { uploaded: 1, state: "complete" };
    });
    await expect(sync().mock.calls[0]![0]).resolves.toBeUndefined();
    expect(mocks.drain).toHaveBeenCalledOnce();
    expect(messages.mock.calls.map(([value]) => value)).toEqual([
      receipt,
      { type: "pkic-scanner-upload-status", uploaded: 1, state: "complete" },
    ]);
    const body = fetcher.mock.calls[0]![1].body;
    if (typeof body !== "string") throw new Error("Scan upload must have a JSON body");
    expect(enrolledEventScanRequestSchema.parse(JSON.parse(body))).toEqual(record.scan);
  });
  it.each([
    { uploaded: 100, state: "retry", retryAfterMs: 100 },
    { uploaded: 0, state: "retry", retryAfterMs: 120_000 },
  ])("rejects waitUntil for pending work without looping: %j", async (result) => {
    mocks.drain.mockResolvedValue(result);
    await expect(sync().mock.calls[0]![0]).rejects.toThrow("Scanner upload remains pending");
    expect(mocks.drain).toHaveBeenCalledOnce();
    expect(fetcher).not.toHaveBeenCalled();
    expect(messages).toHaveBeenCalledExactlyOnceWith({ type: "pkic-scanner-upload-status", ...result });
  });
  it("notifies foreground authentication refusal without automatic retry", async () => {
    const result = { uploaded: 0, state: "authentication_required" };
    mocks.drain.mockResolvedValue(result);
    await expect(sync().mock.calls[0]![0]).resolves.toBeUndefined();
    expect(messages).toHaveBeenCalledExactlyOnceWith({ type: "pkic-scanner-upload-status", ...result });
    expect(mocks.drain).toHaveBeenCalledOnce();
  });
  it("passes throttling and Retry-After to the drainer without an immediate second upload", async () => {
    fetcher.mockResolvedValue(new Response(null, { status: 429, headers: { "Retry-After": "120" } }));
    mocks.drain.mockImplementation(async (upload: (row: OfflineScanRecord) => Promise<Response>) => {
      const response = await upload(record);
      expect(response.status).toBe(429);
      expect(response.headers.get("Retry-After")).toBe("120");
      return { uploaded: 0, state: "retry", retryAfterMs: 120_000 };
    });
    await expect(sync().mock.calls[0]![0]).rejects.toThrow("Scanner upload remains pending");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(messages).toHaveBeenCalledExactlyOnceWith({
      type: "pkic-scanner-upload-status",
      uploaded: 0,
      state: "retry",
      retryAfterMs: 120_000,
    });
  });
  it.each([401, 403])("passes authentication refusal %s without fabricating a receipt", async (status) => {
    fetcher.mockResolvedValue(new Response(null, { status }));
    mocks.drain.mockImplementation(async (upload: (row: OfflineScanRecord) => Promise<Response>) => {
      expect((await upload(record)).status).toBe(status);
      return { uploaded: 0, state: "authentication_required" };
    });
    await expect(sync().mock.calls[0]![0]).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(messages).toHaveBeenCalledExactlyOnceWith({
      type: "pkic-scanner-upload-status",
      uploaded: 0,
      state: "authentication_required",
    });
  });
  it("delivers acknowledged receipts before asking the browser to retry remaining rows", async () => {
    mocks.drain.mockImplementation(async (upload: (row: OfflineScanRecord) => Promise<Response>) => {
      await upload(record);
      return { uploaded: 1, state: "retry", retryAfterMs: 5000 };
    });
    await expect(sync().mock.calls[0]![0]).rejects.toThrow("Scanner upload remains pending");
    expect(messages).toHaveBeenCalledWith(receipt);
    expect(messages).not.toHaveBeenCalledWith(expect.objectContaining({ state: "complete" }));
  });
  it("propagates storage failures instead of claiming completion", async () => {
    mocks.drain.mockRejectedValue(new Error("storage unavailable"));
    await expect(sync().mock.calls[0]![0]).rejects.toThrow("storage unavailable");
    expect(messages).not.toHaveBeenCalled();
  });
  it("does not contact the server or drain while local logout is pending", async () => {
    mocks.suspended.mockResolvedValue(true);
    await expect(sync().mock.calls[0]![0]).resolves.toBeUndefined();
    expect(sessionFetcher).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    expect(mocks.drain).not.toHaveBeenCalled();
    expect(messages).toHaveBeenCalledWith({
      type: "pkic-scanner-upload-status",
      uploaded: 0,
      state: "authentication_required",
    });
  });
  it.each(["newer-same-owner-session", "different-owner-session"])(
    "refuses a stale local hint against %s",
    async (kind) => {
      const canonical = {
        ...portalSessionFixture({}),
        eventParticipation: true,
        sessionId: "00000000-0000-4000-8000-000000000009",
        identity: {
          id: kind === "different-owner-session" ? "other-operator" : record.scan.operatorUserId,
          email: "scanner@example.test",
        },
      };
      sessionFetcher.mockResolvedValue(Response.json(canonical));
      await expect(sync().mock.calls[0]![0]).resolves.toBeUndefined();
      expect(mocks.drain).not.toHaveBeenCalled();
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it("rechecks the logout fence immediately before the cookie upload", async () => {
    mocks.suspended.mockResolvedValueOnce(false).mockResolvedValue(true);
    mocks.drain.mockImplementation(async (upload: (row: OfflineScanRecord) => Promise<Response>, owner: string) => {
      expect(owner).toBe(record.scan.operatorUserId);
      expect((await upload(record)).status).toBe(401);
      return { uploaded: 0, state: "authentication_required" };
    });
    await expect(sync().mock.calls[0]![0]).resolves.toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("ignores unrelated sync registrations", () => {
    expect(sync("other-upload")).not.toHaveBeenCalled();
    expect(mocks.drain).not.toHaveBeenCalled();
  });
});
