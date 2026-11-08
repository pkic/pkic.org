import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { useEligibilityManifest } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/useEligibilityManifest";
import type { ScannerEpoch } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/scanner-device-ledger";
import { SCANNER_ELIGIBILITY_REFRESH_MS } from "../../assets/shared/event-offline-expiry";
import { ScannerSyncStatus } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/ScannerPreparationStatus";
const mocks = vi.hoisted(() => ({ prepare: vi.fn(async (..._args: unknown[]) => ({ refreshError: "" })) }));
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
const upload = vi.fn();
const permissionChanged = vi.fn();
const preparationClosed = vi.fn();
let current: ReturnType<typeof useEligibilityManifest>;
function syncButton() {
  return Array.from(host.querySelectorAll("button")).find((button) => /sync now/i.test(button.textContent!))!;
}
function Scanner({ collector = false }: { collector?: boolean }) {
  const state = useEligibilityManifest(
    "synthetic",
    id,
    null,
    "attendance",
    permissionChanged,
    null,
    epoch,
    collector,
    preparationClosed,
  );
  current = state;
  return (
    <ScannerSyncStatus
      pending={1}
      uploadStatus=""
      action="attendance"
      sync={upload}
      refreshEligibility={state.refresh}
      offline={{ context: null, preparing: false, error: "", retry: () => {} }}
    >
      <output>
        {state.manifestPreparing ? `Checking ${state.manifestProgress ?? 0}` : state.manifestError || "Ready"}
      </output>
    </ScannerSyncStatus>
  );
}
afterEach(async () => {
  await act(() => render(null, host));
  upload.mockReset();
  permissionChanged.mockReset();
  preparationClosed.mockReset();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  mocks.prepare.mockReset().mockResolvedValue({ refreshError: "" });
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
    expect.any(Function),
  );
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  expect(mocks.prepare).toHaveBeenCalledOnce();
});
it("exposes manual refresh progress and does not hide a cached-fallback failure", async () => {
  await act(async () => render(<Scanner />, host));
  await vi.waitFor(() => expect(host.textContent).toContain("Ready"));
  let finish: ((value: { refreshError: string }) => void) | undefined;
  mocks.prepare.mockImplementationOnce(async (...args) => {
    const progress = args[7];
    if (typeof progress !== "function") throw new Error("Expected progress callback");
    progress(250);
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  await act(async () => syncButton().click());
  expect(host.textContent).toContain("Checking 250");
  await act(async () => finish!({ refreshError: "Badge refresh failed (HTTP 503)." }));
  await vi.waitFor(() => expect(host.textContent).toContain("HTTP 503"));
  expect(mocks.prepare).toHaveBeenCalledTimes(2);
  await act(async () => syncButton().click());
  await vi.waitFor(() => expect(host.textContent).toContain("Ready"));
});

it.each([
  ["SCANNER_SIGNED_OUT", /sign in again/i],
  ["SCANNER_PERMISSION_CHANGED", /access changed/i],
  ["SCANNER_PREPARATION_CLOSED", /session has closed/i],
  ["Eligibility snapshot too large", /contact support/i],
  ["Eligibility pagination repeated", /contact support/i],
  ["Eligibility page digest changed", /contact support/i],
] as const)("explains the recovery action for %s", async (message, action) => {
  mocks.prepare.mockRejectedValueOnce(new Error(message));
  await act(async () => render(<Scanner />, host));
  await vi.waitFor(() => expect(host.textContent).toMatch(action));
  expect(host.textContent).not.toMatch(/check your connection/i);
});

it("keeps uploads available during badge preparation without overlapping roster refreshes", async () => {
  await act(async () => render(<Scanner />, host));
  let finish!: (value: { refreshError: string }) => void;
  mocks.prepare.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => syncButton().click());
  expect(current.manifestPreparing).toBe(true);
  expect(syncButton().disabled).toBe(false);
  await act(async () => syncButton().click());
  expect(upload).toHaveBeenCalledTimes(2);
  expect(mocks.prepare).toHaveBeenCalledTimes(2);
  await act(async () => finish({ refreshError: "" }));
  expect(current.manifestPreparing).toBe(false);
});

it.each([false, true])("separates closed-session handling from sign-in refusals (collector: %s)", async (collector) => {
  await act(async () => render(<Scanner collector={collector} />, host));
  await vi.waitFor(() => expect(current.manifestReady).toBe(true));
  mocks.prepare.mockRejectedValueOnce(new Error("SCANNER_PREPARATION_CLOSED"));
  await act(async () => syncButton().click());
  await vi.waitFor(() => expect(current.manifestReady).toBe(false));
  expect(current.eligibilityManifest.current).toBeNull();
  expect(preparationClosed).toHaveBeenCalledOnce();
  expect(permissionChanged).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(current.manifestError).toMatch(/session has closed/i));
  expect(current.manifestError).not.toMatch(/sign.in|connect/i);
});

it.each(["SCANNER_SIGNED_OUT", "SCANNER_PERMISSION_CHANGED"])(
  "preserves collector recovery guidance for %s",
  async (message) => {
    mocks.prepare.mockRejectedValueOnce(new Error(message));
    await act(async () => render(<Scanner collector />, host));
    expect(current.manifestReady).toBe(false);
    expect(permissionChanged).toHaveBeenCalledOnce();
    expect(preparationClosed).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(current.manifestError).toMatch(message === "SCANNER_SIGNED_OUT" ? /sign in again/i : /access changed/i),
    );
  },
);

it.each(["Eligibility revision changed", "Eligibility snapshot expired during preparation"])(
  "offers retry for transient snapshot failure: %s",
  async (message) => {
    mocks.prepare.mockRejectedValueOnce(new Error(message));
    await act(async () => render(<Scanner />, host));
    await vi.waitFor(() => expect(current.manifestError).toMatch(/try again/i));
    expect(current.manifestError).not.toMatch(/support/i);
    expect(permissionChanged).not.toHaveBeenCalled();
    expect(preparationClosed).not.toHaveBeenCalled();
    await act(async () => syncButton().click());
    await vi.waitFor(() => expect(current.manifestReady).toBe(true));
  },
);
