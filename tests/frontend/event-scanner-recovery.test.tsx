import { render } from "preact";
import { formatNumber } from "../../assets/shared/format-number";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { scanRecoverySchema } from "../../assets/shared/schemas/event-scan-recovery";
const importer = vi.hoisted(() => vi.fn(async () => ({ queued: 1, archived: 0 })));
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/scanner/scan-recovery-import", () => ({
  importScanRecovery: importer,
  CANONICAL_RECOVERY_EXPORT_BYTE_LIMIT: 100 * 1024 * 1024,
}));
const history = vi.hoisted(() => ({
  count: vi.fn(async () => 2400),
  pending: vi.fn(async () => 3),
  restore: vi.fn(async () => ({ restored: 2400, nextCursor: null })),
  snapshot: vi.fn(async () => ({ records: [], pending: [], scannerEpochs: [] })),
  pendingPage: vi.fn(async () => ({ records: [], nextCursor: null })),
}));
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/scanner/scan-history", () => ({
  scanHistoryCount: history.count,
  pendingRecoveryCount: history.pending,
  restoreScanHistory: history.restore,
  scannerRecoverySnapshot: history.snapshot,
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
    expect(host.textContent).toContain(
      `${formatNumber(2400)} uploaded scans available for this event and your account.`,
    );
    expect(host.textContent).toContain(`${formatNumber(3)} pending scans included in recovery downloads.`);
    expect(history.count).toHaveBeenCalledWith(operator, "synthetic-event");
    expect(history.pending).toHaveBeenCalledWith(operator, "synthetic-event");
    const restore = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "Restore uploaded scans",
    )!;
    await act(async () => {
      restore.click();
    });
    expect(history.restore).toHaveBeenCalledWith(operator, "synthetic-event", undefined);
    expect(host.textContent).toContain(`${formatNumber(2400)} scans queued for recovery`);
  });
  it("imports a selected downloaded file through the current account and event scope", async () => {
    host = document.createElement("div");
    document.body.append(host);
    const sessionId = "88888888-8888-4888-8888-888888888888";
    await act(async () => {
      render(<ScannerRecovery slug="synthetic-event" operatorUserId={operator} sessionId={sessionId} />, host);
    });
    await vi.waitFor(() => {
      expect(host.textContent).toContain(
        `${formatNumber(2400)} uploaded scans available for this event and your account.`,
      );
    });
    const button = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "Import recovery file",
    )!;
    expect(button.disabled).toBe(true);
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(host.querySelector(`label[for="${input.id}"]`)?.textContent).toBe("Recovery file");
    const text = JSON.stringify({ version: 1 });
    const file = new File([text], "scan-recovery-synthetic-event.json", { type: "application/json" });
    Object.defineProperty(file, "text", { value: async () => text });
    Object.defineProperty(input, "files", { value: [file] });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(button.disabled).toBe(false);
    await act(async () => {
      button.click();
    });
    expect(importer).toHaveBeenCalledWith(
      text,
      expect.objectContaining({
        eventId: "synthetic-event",
        operatorUserId: operator,
        sessionId,
        signal: expect.any(AbortSignal),
      }),
    );
    await vi.waitFor(() => {
      expect(host.querySelector('[role="status"]')?.textContent).toContain(
        `Imported ${formatNumber(1)} scans for recovery`,
      );
    });
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
