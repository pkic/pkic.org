import { describe, expect, it } from "vitest";
import { scannerPermission, availableScannerActions } from "../../assets/shared/event-scanner-permissions";
import { resolveBadgeExpiry } from "../../functions/_lib/services/event-participation/badge-expiry";
describe("Scanner capability compatibility", () => {
  it("offers checkout only with attendance recording authority and keeps check and admission grants independent", () => {
    expect(availableScannerActions((value) => value === "agenda:attendance_record")).toEqual([
      "attendance",
      "checkout",
    ]);
    expect(availableScannerActions((value) => value === "agenda:check")).toEqual(["check"]);
    expect(availableScannerActions((value) => value === "agenda:admit")).toEqual(["admission"]);
    expect(availableScannerActions((value) => value === "agenda:scan")).toEqual([
      "check",
      "admission",
      "attendance",
      "checkout",
    ]);
  });
  it("does not imply other fine-grained actions", () => {
    expect(scannerPermission((value) => value === "agenda:check", "agenda:admit")).toBeNull();
    expect(scannerPermission((value) => value === "agenda:scan", "agenda:admit")).toBe("agenda:scan");
  });
  it("expires indefinite badges after one day and refuses expired default issuance", () => {
    expect(resolveBadgeExpiry("2030-01-01T00:00:00.000Z", null)).toBe("2030-01-02T00:00:00.000Z");
    expect(() => resolveBadgeExpiry("2030-01-01T00:00:00.000Z", "2029-12-31T00:00:00.000Z")).toThrow();
    expect(resolveBadgeExpiry("2030-01-01T00:00:00.000Z", "2029-12-31T00:00:00.000Z", "2030-01-03T00:00:00.000Z")).toBe(
      "2030-01-03T00:00:00.000Z",
    );
  });
});
