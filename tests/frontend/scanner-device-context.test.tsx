import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { scannerOfflineContextSchema } from "../../assets/shared/schemas/event-scanner-offline-context";
import { useScannerDevice } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/useScannerDevice";
const mocks = vi.hoisted(() => ({ read: vi.fn(async () => ({ state: "open" })) }));
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/scanner/scanner-offline-context", () => ({
  readScannerOfflineEpoch: mocks.read,
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
