import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { useEligibilityManifest } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/useEligibilityManifest";
import type { ScannerEpoch } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/scanner-device-ledger";
import { SCANNER_ELIGIBILITY_REFRESH_MS } from "../../assets/shared/event-offline-expiry";
const mocks = vi.hoisted(() => ({ prepare: vi.fn(async () => ({})) }));
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/scanner/eligibility-manifest", () => ({
  prepareEligibilityManifest: mocks.prepare,
}));
const id = "11111111-1111-4111-8111-111111111111";
const epoch: ScannerEpoch = {
  key: "synthetic",
  eventId: id,
  operatorUserId: id,
  deviceId: id,
  enrollmentOperationId: id,
  epochId: id,
  openedAt: "2026-11-06T08:00:00.000Z",
  issuedHighWater: 0,
  state: "open",
  closingOperationId: null,
};
const host = document.createElement("div");
function Scanner({ collector = false }: { collector?: boolean }) {
  useEligibilityManifest("synthetic", id, null, "attendance", () => {}, null, epoch, collector);
  return null;
}
afterEach(async () => {
  await act(() => render(null, host));
  vi.useRealTimers();
  vi.unstubAllGlobals();
  mocks.prepare.mockClear();
});
it("refreshes well before the day expires and immediately after reconnect or focus", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("navigator", { onLine: true });
  await act(async () => render(<Scanner />, host));
  expect(mocks.prepare).toHaveBeenCalledOnce();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(SCANNER_ELIGIBILITY_REFRESH_MS);
  });
  expect(mocks.prepare).toHaveBeenCalledTimes(2);
  await act(async () => {
    window.dispatchEvent(new Event("online"));
  });
  expect(mocks.prepare).toHaveBeenCalledTimes(3);
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  expect(mocks.prepare).toHaveBeenCalledTimes(4);
});
it("restores offline checks from storage without attempting a network refresh", async () => {
  vi.stubGlobal("navigator", { onLine: false });
  await act(async () => render(<Scanner collector />, host));
  expect(mocks.prepare).toHaveBeenCalledWith(
    "synthetic",
    id,
    null,
    { epochId: id, deviceId: id },
    expect.any(AbortSignal),
    null,
    "cache",
  );
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  expect(mocks.prepare).toHaveBeenCalledOnce();
});
