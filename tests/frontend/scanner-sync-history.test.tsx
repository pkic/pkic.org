import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const history = vi.hoisted(() => vi.fn());
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/scanner/scan-history", () => ({
  lastSuccessfulScanSync: history,
}));
import { useScannerSyncHistory } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/useScannerSyncHistory";
let host: HTMLDivElement, worker: EventTarget;
function Status({ owner, event }: { owner: string; event: string }) {
  const { lastSync } = useScannerSyncHistory(owner, event);
  return <p>{lastSync === undefined ? "unavailable" : lastSync === null ? "no retained receipt" : lastSync}</p>;
}
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  worker = new EventTarget();
  vi.stubGlobal("navigator", { serviceWorker: worker });
  history.mockReset();
});
afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
});
it("reads the current scope on mount and refreshes once for a completed worker batch, not empty drains or individual receipts", async () => {
  history.mockResolvedValue("2026-10-05T09:00:00.000Z");
  await act(async () => {
    render(<Status owner="operator-A" event="event-A" />, host);
  });
  await vi.waitFor(() => expect(host.textContent).toBe("2026-10-05T09:00:00.000Z"));
  expect(history).toHaveBeenCalledExactlyOnceWith("operator-A", "event-A");
  worker.dispatchEvent(
    new MessageEvent("message", { data: { type: "pkic-scanner-upload-status", uploaded: 0, state: "complete" } }),
  );
  worker.dispatchEvent(new MessageEvent("message", { data: { operationId: "individual-receipt" } }));
  expect(history).toHaveBeenCalledTimes(1);
  history.mockResolvedValue("2026-10-05T09:05:00.000Z");
  worker.dispatchEvent(
    new MessageEvent("message", { data: { type: "pkic-scanner-upload-status", uploaded: 20, state: "complete" } }),
  );
  await vi.waitFor(() => expect(host.textContent).toBe("2026-10-05T09:05:00.000Z"));
  expect(history).toHaveBeenCalledTimes(2);
  render(null, host);
  worker.dispatchEvent(
    new MessageEvent("message", { data: { type: "pkic-scanner-upload-status", uploaded: 1, state: "complete" } }),
  );
  expect(history).toHaveBeenCalledTimes(2);
});
it("does not show another owner's timestamp while a late history read resolves", async () => {
  let resolveA!: (value: string) => void;
  history
    .mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveA = resolve;
        }),
    )
    .mockResolvedValue("2026-10-05T10:00:00.000Z");
  await act(async () => {
    render(<Status owner="operator-A" event="event-A" />, host);
  });
  await vi.waitFor(() => expect(history).toHaveBeenCalledWith("operator-A", "event-A"));
  await act(async () => {
    render(<Status owner="operator-B" event="event-B" />, host);
  });
  await vi.waitFor(() => expect(host.textContent).toBe("2026-10-05T10:00:00.000Z"));
  await act(async () => {
    resolveA("2026-10-05T09:00:00.000Z");
  });
  expect(host.textContent).toBe("2026-10-05T10:00:00.000Z");
});
it("shows storage unavailable distinctly from an empty retained history", async () => {
  history.mockRejectedValue(new Error("Storage unavailable"));
  await act(async () => {
    render(<Status owner="operator-A" event="event-A" />, host);
  });
  await vi.waitFor(() => expect(history).toHaveBeenCalledTimes(1));
  expect(host.textContent).toBe("unavailable");
  history.mockResolvedValue(null);
  worker.dispatchEvent(
    new MessageEvent("message", { data: { type: "pkic-scanner-upload-status", uploaded: 1, state: "complete" } }),
  );
  await vi.waitFor(() => expect(host.textContent).toBe("no retained receipt"));
});
