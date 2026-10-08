import { describe, expect, it, vi } from "vitest";
import { scannerWorkerMessageListener } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/scanner-worker-messages";
import { scannerUploadStatusMessageSchema } from "../../assets/shared/schemas/event-scan-upload-status";

const operationId = "00000000000000000000000000000001";
const receipt = { operationId, outcome: "eligible", reason: "eligible", recorded: true, attendanceRecorded: true };
function harness() {
  const ownOperator = "current-operator";
  const pendingCount = vi.fn();
  const ownDrain = vi.fn();
  const callbacks = {
    currentOperation: vi.fn((): string | null => operationId),
    authorityPaused: vi.fn(() => false),
    setResult: vi.fn(),
    refreshPending: () => pendingCount(ownOperator),
    syncCurrentOperator: () => ownDrain(ownOperator),
  };
  const receive = scannerWorkerMessageListener(callbacks);
  return { callbacks, pendingCount, ownDrain, send: (data: unknown) => receive({ data } as MessageEvent<unknown>) };
}
describe("scanner worker messages scoped to the mounted operator", () => {
  it.each(["authentication_required", "retry", "complete"])("treats global %s as an own-queue wake only", (state) => {
    const h = harness();
    h.send({ type: "pkic-scanner-upload-status", uploaded: 100, state });
    expect(h.ownDrain).toHaveBeenCalledExactlyOnceWith("current-operator");
    expect(h.callbacks.authorityPaused).not.toHaveBeenCalled();
    expect(h.callbacks.setResult).not.toHaveBeenCalled();
    expect(h.pendingCount).not.toHaveBeenCalled();
  });
  it("lets the current operator's own drain decide counts and authority after another operator's refusal", () => {
    const h = harness();
    let paused = false;
    let pending = 3;
    h.ownDrain.mockImplementation((operator: string) => {
      expect(operator).toBe("current-operator");
      // Our authorized queue succeeds even if an old operator failed in the worker.
      pending = 0;
      paused = false;
    });
    h.send({ type: "pkic-scanner-upload-status", uploaded: 0, state: "authentication_required" });
    expect(paused).toBe(false);
    expect(pending).toBe(0);
    expect(h.callbacks.setResult).not.toHaveBeenCalled();
  });
  it("updates only the last matching operation and refreshes own pending", () => {
    const h = harness();
    h.send(receipt);
    expect(h.callbacks.setResult).toHaveBeenCalledExactlyOnceWith(receipt);
    expect(h.pendingCount).toHaveBeenCalledExactlyOnceWith("current-operator");
    expect(h.ownDrain).not.toHaveBeenCalled();
  });
  it("ignores a stale operator receipt for display while refreshing only own pending", () => {
    const h = harness();
    h.send({ ...receipt, operationId: "00000000000000000000000000000002" });
    expect(h.callbacks.setResult).not.toHaveBeenCalled();
    expect(h.pendingCount).toHaveBeenCalledExactlyOnceWith("current-operator");
  });
  it("does not display matching receipts while own authority is paused", () => {
    const h = harness();
    h.callbacks.authorityPaused.mockReturnValue(true);
    h.send(receipt);
    expect(h.callbacks.setResult).not.toHaveBeenCalled();
    expect(h.pendingCount).toHaveBeenCalledExactlyOnceWith("current-operator");
  });
  it.each([
    { type: "unrelated" },
    { type: "pkic-scanner-upload-status", uploaded: -1, state: "retry" },
    { type: "pkic-scanner-upload-status", uploaded: 1, state: "retry", retryAfterMs: -1 },
    { type: "pkic-scanner-upload-status", uploaded: 1, state: "retry", operatorUserId: "old" },
  ])("ignores malformed or private status metadata %j", (data) => {
    const h = harness();
    expect(scannerUploadStatusMessageSchema.safeParse(data).success).toBe(false);
    h.send(data);
    expect(h.ownDrain).not.toHaveBeenCalled();
    expect(h.pendingCount).not.toHaveBeenCalled();
    expect(h.callbacks.setResult).not.toHaveBeenCalled();
  });
});
