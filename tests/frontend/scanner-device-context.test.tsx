import { ScannerSessionControls } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/ScannerSessionControls";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { scannerOfflineContextSchema } from "../../assets/shared/schemas/event-scanner-offline-context";
import { useScannerDevice } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/useScannerDevice";
const mocks = vi.hoisted(() => ({ read: vi.fn(async () => ({ state: "open" })), prepare: vi.fn(), next: vi.fn() }));
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/scanner/scanner-offline-context", () => ({
  readScannerOfflineEpoch: mocks.read,
}));
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/scanner/scanner-device-ledger", () => ({
  prepareScannerDevice: async () => "11111111-1111-4111-8111-111111111111",
  prepareScannerEpoch: mocks.prepare,
  startNextScannerEpoch: mocks.next,
}));
const id = "11111111-1111-4111-8111-111111111111";
const context = scannerOfflineContextSchema.parse({
  eventId: id,
  slug: "synthetic",
  route: "/events/synthetic/scanner",
  operatorUserId: id,
  sessionId: id,
  deviceId: id,
  epochId: id,
  occurrenceId: null,
  roomId: null,
  action: "attendance",
  publishedRevision: 1,
  serverNow: "2026-11-06T08:00:00.000Z",
  expiresAt: "2026-11-07T00:00:00.000Z",
  savedAt: "2026-11-06T08:00:00.000Z",
  lastObservedAt: "2026-11-06T08:00:00.000Z",
});
const host = document.createElement("div");
afterEach(async () => {
  await act(() => render(null, host));
  mocks.read.mockClear();
});
it("keeps the prepared device ready when the offline clock checkpoint advances", async () => {
  function Scanner({ observedAt }: { observedAt: string }) {
    const device = useScannerDevice("synthetic", id, undefined, { ...context, lastObservedAt: observedAt });
    return <output>{device.ready ? "ready" : "preparing"}</output>;
  }
  await act(async () => render(<Scanner observedAt={context.lastObservedAt} />, host));
  await vi.waitFor(() => expect(host.textContent).toBe("ready"));
  await act(async () => render(<Scanner observedAt="2026-11-06T08:00:01.000Z" />, host));
  expect(host.textContent).toBe("ready");
  expect(mocks.read).toHaveBeenCalledOnce();
});

it("reconciles a server closure and offers the next session without posting another close", async () => {
  mocks.prepare.mockResolvedValueOnce({ epochId: id, deviceId: id, state: "open" });
  let scanner!: ReturnType<typeof useScannerDevice>;
  function Scanner() {
    scanner = useScannerDevice("synthetic", id);
    return (
      <ScannerSessionControls
        scanner={scanner}
        slug="synthetic"
        operatorUserId={id}
        capturePause={() => {}}
        sync={async () => {}}
        message={() => {}}
      />
    );
  }
  await act(async () => render(<Scanner />, host));
  await vi.waitFor(() => expect(scanner.ready).toBe(true));
  mocks.prepare.mockResolvedValueOnce({ epochId: id, deviceId: id, state: "closed" });
  await act(async () => scanner.reconcile());
  await vi.waitFor(() => expect(scanner.ready).toBe(false));
  const next = Array.from(host.querySelectorAll("button")).find((button) => /start next/i.test(button.textContent!))!;
  expect(next).toBeDefined();
  mocks.next.mockResolvedValueOnce({ epochId: "22222222-2222-4222-8222-222222222222", deviceId: id, state: "open" });
  await act(async () => next.click());
  await vi.waitFor(() => expect(scanner.ready).toBe(true));
  expect(mocks.next).toHaveBeenCalledOnce();
});
