import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as eligibility from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/eligibility-manifest";
import { useEligibilityManifest } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/useEligibilityManifest";
import type { ScannerEpoch } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/scanner-device-ledger";

const epoch: ScannerEpoch = {
  key: JSON.stringify(["event", "operator", "device"]),
  eventId: "event",
  operatorUserId: "operator",
  deviceId: "device",
  epochId: "epoch",
  enrollmentOperationId: "enrollment",
  issuedHighWater: 0,
  openedAt: "2026-12-01T08:00:00.000Z",
  state: "open",
  closingOperationId: null,
};
const manifest: eligibility.EligibilityManifest = {
  operatorUserId: "operator",
  occurrenceId: null,
  publishedRevision: null,
  serverNow: "2026-12-01T08:00:00.000Z",
  expiresAt: "2026-12-05T00:00:00.000Z",
  validUntil: Date.parse("2026-12-05T00:00:00.000Z"),
  lookup: async () => ({ outcome: "eligible", reason: "eligible", message: "Registered." }),
};
let host: HTMLDivElement;
let latest: ReturnType<typeof useEligibilityManifest>;
const refused = vi.fn();
function Harness({ names = false }: { names?: boolean }) {
  latest = useEligibilityManifest({
    slug: "event",
    operatorUserId: "operator",
    occurrenceId: null,
    action: "attendance",
    onPermissionChanged: refused,
    epoch,
    includeBadgeNames: names,
  });
  return <span>{latest.manifestReady ? "Ready" : "Preparing"}</span>;
}
describe("scanner background preparation", () => {
  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
  });
  afterEach(async () => {
    await act(() => render(null, host));
    host.remove();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });
  it("does not overlap preparation when reconnect events arrive during a download", async () => {
    let finish!: (manifest: eligibility.EligibilityManifest) => void;
    const prepare = vi.spyOn(eligibility, "prepareEligibilityManifest").mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await act(() => render(<Harness />, host));
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce());
    await act(() => {
      window.dispatchEvent(new Event("online"));
      window.dispatchEvent(new Event("online"));
    });
    expect(prepare).toHaveBeenCalledOnce();
    await act(async () => finish(manifest));
    expect(latest.manifestReady).toBe(true);
  });
  it("does not reuse ordinary readiness when switching to badge collection", async () => {
    const prepare = vi.spyOn(eligibility, "prepareEligibilityManifest").mockResolvedValueOnce(manifest);
    await act(() => render(<Harness />, host));
    await vi.waitFor(() => expect(latest.manifestReady).toBe(true));
    let finish!: (manifest: eligibility.EligibilityManifest) => void;
    prepare.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await act(() => render(<Harness names />, host));
    expect(latest.manifestReady).toBe(false);
    expect(latest.manifestPreparing).toBe(true);
    expect(prepare.mock.calls.at(-1)?.at(-1)).toBe(true);
    await act(async () => finish(manifest));
    expect(latest.manifestReady).toBe(true);
  });
  it("retains ready local data while refreshing and after a transient failure", async () => {
    const prepare = vi.spyOn(eligibility, "prepareEligibilityManifest").mockResolvedValueOnce(manifest);
    await act(() => render(<Harness />, host));
    await vi.waitFor(() => expect(latest.manifestReady).toBe(true));
    let fail!: (error: Error) => void;
    prepare.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          fail = reject;
        }),
    );
    await act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(latest.manifestPreparing).toBe(true);
    expect(latest.manifestReady).toBe(true);
    expect(latest.eligibilityManifest.current).toBe(manifest);
    await act(async () => fail(new Error("Network unavailable")));
    expect(latest.manifestReady).toBe(true);
    expect(latest.eligibilityManifest.current).toBe(manifest);
    expect(refused).not.toHaveBeenCalled();
  });
});
