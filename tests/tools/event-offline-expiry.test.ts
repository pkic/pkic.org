import { describe, expect, it } from "vitest";
import { offlineEligibilityExpiresAt } from "../../assets/shared/event-offline-expiry";

describe("Offline eligibility calendar expiry", () => {
  it("expires at event midnight rather than retaining the preceding day", () => {
    expect(offlineEligibilityExpiresAt("2026-10-03T21:55:00.000Z", "Europe/Amsterdam")).toBe(
      "2026-10-03T22:00:00.000Z",
    );
    expect(offlineEligibilityExpiresAt("2026-10-03T23:59:59.500Z", "UTC")).toBe("2026-10-04T00:00:00.000Z");
  });
  it("remains valid until local midnight across DST offset changes", () => {
    expect(offlineEligibilityExpiresAt("2026-10-25T00:55:00.000Z", "Europe/Amsterdam")).toBe(
      "2026-10-25T23:00:00.000Z",
    );
  });
  it("covers an entire twenty-five-hour local day when clocks go back", () => {
    expect(offlineEligibilityExpiresAt("2026-10-24T22:00:00.000Z", "Europe/Amsterdam")).toBe(
      "2026-10-25T23:00:00.000Z",
    );
    expect(offlineEligibilityExpiresAt("2026-10-03T00:00:00.000Z", "UTC")).toBe("2026-10-04T00:00:00.000Z");
  });
  it("uses event timezone without any event calendar rows", () => {
    expect(offlineEligibilityExpiresAt("2026-10-03T14:55:00.000Z", "Asia/Tokyo")).toBe("2026-10-03T15:00:00.000Z");
  });
});
