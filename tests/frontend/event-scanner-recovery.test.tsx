import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { scanRecoverySchema } from "../../assets/shared/schemas/event-scan-recovery";
const history = vi.hoisted(() => ({
  count: vi.fn(async () => 2400),
  pending: vi.fn(async () => 3),
  restore: vi.fn(async () => ({ restored: 2400, nextCursor: null })),
  list: vi.fn(async () => ({ records: [], nextCursor: null })),
  pendingPage: vi.fn(async () => ({ records: [], nextCursor: null })),
}));
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/scanner/scan-history", () => ({
  scanHistoryCount: history.count,
  pendingRecoveryCount: history.pending,
  restoreScanHistory: history.restore,
  listScanHistory: history.list,
  pendingRecoveryPage: history.pendingPage,
}));
import { ScannerRecovery } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/ScannerRecovery";
const operator = "11111111-1111-4111-8111-111111111111";
let host: HTMLDivElement;
afterEach(() => {
  if (host) {
    render(null, host);
    host.remove();
  }
  vi.clearAllMocks();
});
describe("scoped scanner recovery", () => {
  it("shows uploaded and pending counts only for the current operator and event", async () => {
    host = document.createElement("div");
    document.body.append(host);
    await act(async () => {
      render(<ScannerRecovery slug="synthetic-event" operatorUserId={operator} />, host);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host.textContent).toContain("2400 uploaded scans available for this event and your account.");
    expect(host.textContent).toContain("3 pending scans included in recovery downloads.");
    expect(history.count).toHaveBeenCalledWith(operator, "synthetic-event");
    expect(history.pending).toHaveBeenCalledWith(operator, "synthetic-event");
    const restore = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "Restore uploaded scans",
    )!;
    await act(async () => {
      restore.click();
    });
    expect(history.restore).toHaveBeenCalledWith(operator, "synthetic-event", undefined);
    expect(host.textContent).toContain("2400 scans queued for recovery");
  });
  it("rejects profile fields in recovery files", () => {
    expect(
      scanRecoverySchema.safeParse({
        version: 1,
        operatorUserId: operator,
        eventId: "synthetic-event",
        exportedAt: new Date().toISOString(),
        records: [],
        pending: [],
        email: "private@example.test",
      }).success,
    ).toBe(false);
  });
});
