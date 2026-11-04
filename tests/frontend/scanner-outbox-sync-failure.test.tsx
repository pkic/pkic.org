import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { scannerOfflineContextSchema } from "../../assets/shared/schemas/event-scanner-offline-context";
import { useScannerOutboxSync } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/useScannerOutboxSync";

const mocks = vi.hoisted(() => ({ count: vi.fn<() => Promise<number>>(), drain: vi.fn() }));
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/scanner/scan-outbox", () => ({
  pendingScanCount: mocks.count,
  drainScanOutbox: mocks.drain,
  requestScanOutboxBackgroundSync: vi.fn(),
}));
const id = "11111111-1111-4111-8111-111111111111";
const now = "2026-10-07T09:00:00.000Z";
const collector = scannerOfflineContextSchema.parse({
  eventId: id,
  slug: "synthetic",
  route: "/events/synthetic/scanner",
  operatorUserId: id,
  sessionId: id,
  deviceId: id,
  epochId: id,
  occurrenceId: id,
  roomId: id,
  action: "attendance",
  publishedRevision: 7,
  serverNow: now,
  expiresAt: "2026-10-07T09:15:00.000Z",
  savedAt: now,
  lastObservedAt: now,
});
const host = document.createElement("div");
function Harness({ offline }: { offline: boolean }) {
  const state = useScannerOutboxSync({
    slug: "synthetic",
    operatorUserId: id,
    collectorContext: offline ? collector : undefined,
    authorityPaused: { current: false },
    currentOperation: () => null,
    presentReceipt: () => {},
    setResult: () => {},
    setMessage: () => {},
    stopCamera: () => {},
    refreshHistory: async () => {},
  });
  return (
    <p>
      {state.syncing ? "syncing" : "idle"} {state.uploadStatus}
    </p>
  );
}
afterEach(() => {
  render(null, host);
  vi.restoreAllMocks();
});
it("reports collector storage failure and releases syncing", async () => {
  mocks.count.mockRejectedValue(new Error("storage unavailable"));
  await act(async () => {
    render(<Harness offline />, host);
  });
  await vi.waitFor(() => expect(host.textContent).toContain("Local scan storage is unavailable"));
  expect(host.textContent).toContain("idle");
});
it("does not schedule a retry after the scanner unmounts", async () => {
  let reject!: (error: Error) => void;
  mocks.drain.mockImplementation(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  const timers = vi.spyOn(window, "setTimeout");
  await act(async () => {
    render(<Harness offline={false} />, host);
  });
  await act(() => {
    render(null, host);
  });
  timers.mockClear();
  await act(async () => {
    reject(new Error("storage unavailable"));
  });
  expect(timers).not.toHaveBeenCalled();
});
