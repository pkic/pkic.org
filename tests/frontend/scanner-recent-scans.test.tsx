import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ pending: vi.fn(), history: vi.fn() }));
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/scanner/scanner-recent-scans", () => ({
  recentPendingScans: mocks.pending,
}));
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/scanner/scan-history", () => ({
  listScanHistory: mocks.history,
}));
import { ScannerRecentScans } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/ScannerRecentScans";
let host: HTMLDivElement;
afterEach(() => {
  if (host) {
    render(null, host);
    host.remove();
  }
});
describe("scanner audit inspection", () => {
  it("shows retained failed raw input as escaped text with pending status and truncation", async () => {
    const raw = '<img src=x onerror="alert(1)"> https://example.test/';
    mocks.pending.mockResolvedValue({
      total: 1,
      records: [
        {
          kind: "failure",
          eventId: "synthetic",
          scan: {
            operationId: "op",
            action: "attendance",
            observedAt: "2026-10-12T10:00:00.000Z",
            scannedValue: raw,
            scannedValueTruncated: true,
          },
        },
      ],
    });
    mocks.history.mockResolvedValue({ records: [], nextCursor: null });
    host = document.createElement("div");
    document.body.append(host);
    await act(async () => {
      render(<ScannerRecentScans slug="synthetic" operatorUserId="operator" pending={1} />, host);
    });
    await vi.waitFor(() => expect(host.textContent).toContain(raw));
    expect(host.textContent).toContain("Pending sync");
    expect(host.textContent).toContain("(truncated)");
    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector('a[href="https://example.test/"]')).toBeNull();
    expect(host.querySelector("details")).toBeNull();
  });
});
