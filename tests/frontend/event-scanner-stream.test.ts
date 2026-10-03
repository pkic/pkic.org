import { describe, expect, it } from "vitest";
import {
  ScanFrameGate,
  receiptMatchesOperation,
} from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/scan-stream";

describe("continuous phone badge scanning", () => {
  it("accepts 500 distinct badges at four per second without dropping any while suppressing repeated frames", () => {
    const frames = new ScanFrameGate();
    let accepted = 0;
    for (let index = 0; index < 500; index++) {
      const credential = `opaque-badge-${index}`;
      const instant = index * 250;
      if (frames.accept(credential, instant)) accepted++;
      expect(frames.accept(credential, instant + 40)).toBe(false);
      expect(frames.accept(credential, instant + 80)).toBe(false);
    }
    expect(accepted).toBe(500);
  });
  it("does not record another attendance for a badge held in view or alternating frames", () => {
    const frames = new ScanFrameGate();
    expect(frames.accept("first", 0)).toBe(true);
    expect(frames.accept("second", 100)).toBe(true);
    for (let instant = 200; instant < 12_000; instant += 100) {
      expect(frames.accept("first", instant)).toBe(false);
      expect(frames.accept("second", instant + 25)).toBe(false);
    }
    expect(frames.accept("first", 15_000)).toBe(true);
  });
  it("ignores old green acknowledgments while a newer badge is awaiting verification", () => {
    let current: string | null = "first-operation";
    const firstReceipt = { operationId: "first-operation", outcome: "eligible" };
    expect(receiptMatchesOperation(firstReceipt.operationId, current)).toBe(true);
    current = "next-operation";
    expect(receiptMatchesOperation(firstReceipt.operationId, current)).toBe(false);
    expect(receiptMatchesOperation("next-operation", current)).toBe(true);
    current = null;
    expect(receiptMatchesOperation("next-operation", current)).toBe(false);
  });
});
