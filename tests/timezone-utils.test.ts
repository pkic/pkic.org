import { describe, expect, it } from "vitest";
import { isoToDateInTimeZone, isoToTimeInTimeZone, localDateTimeInTimeZoneToIso } from "../functions/_lib/utils/timezone";

describe("event day timezone helpers", () => {
  it("round-trips a local event day time in the event timezone", () => {
    const iso = localDateTimeInTimeZoneToIso("2026-12-01", "08:00", "Europe/Amsterdam");

    expect(iso).toBe("2026-12-01T07:00:00.000Z");
    expect(isoToDateInTimeZone(iso, "Europe/Amsterdam")).toBe("2026-12-01");
    expect(isoToTimeInTimeZone(iso, "Europe/Amsterdam")).toBe("08:00");
  });

  it("rejects local times that do not exist in the event timezone", () => {
    expect(() => localDateTimeInTimeZoneToIso("2026-03-29", "02:30", "Europe/Amsterdam")).toThrow(
      /INVALID_EVENT_DAY_TIME|not valid/i,
    );
  });
});