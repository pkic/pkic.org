import { describe, it, expect } from "vitest";
import { ScanCooldownGate } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/scan-cooldown";
describe("scanner feedback dwell", () => {
  it("accepts one badge, preserves its saving operation, then waits exactly600ms", () => {
    const gate = new ScanCooldownGate();
    expect(gate.accept(100)).toBe(true);
    expect(gate.accept(200)).toBe(false);
    gate.skip();
    expect(gate.ready(300)).toBe(false);
    gate.feedback(300);
    expect(gate.remaining(600)).toBe(300);
    expect(gate.accept(899)).toBe(false);
    expect(gate.accept(900)).toBe(true);
  });
  it("allows immediate next-badge collection after skipping a feedback pause", () => {
    const gate = new ScanCooldownGate();
    gate.accept(0);
    gate.feedback(10);
    expect(gate.ready(20)).toBe(false);
    gate.skip();
    expect(gate.accept(20)).toBe(true);
  });
  it("supports zero delay without bypassing the durable-saving gate", () => {
    const gate = new ScanCooldownGate(0);
    expect(gate.accept(0)).toBe(true);
    expect(gate.accept(1)).toBe(false);
    gate.feedback(2);
    expect(gate.accept(2)).toBe(true);
  });
});
