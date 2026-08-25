import { describe, expect, it } from "vitest";
import {
  dateTimeLocalToIso,
  instantToDateTimeLocal,
  parseDateTimeLocal,
  zonedDateTimeToDate,
} from "../assets/shared/timezone";
import { localDateTimeInTimeZoneToIso } from "../functions/_lib/utils/timezone";

describe("shared IANA time-zone conversion", () => {
  it("round-trips UTC and a daylight-saving-aware local time", () => {
    expect(dateTimeLocalToIso("2026-01-15T09:30", "UTC")).toBe("2026-01-15T09:30:00.000Z");
    expect(instantToDateTimeLocal("2026-07-15T07:30:00.000Z", "Europe/Amsterdam")).toBe("2026-07-15T09:30");
    expect(dateTimeLocalToIso("2026-07-15T09:30", "Europe/Amsterdam")).toBe("2026-07-15T07:30:00.000Z");
  });

  it("rejects invalid calendar values, unknown zones, and daylight-saving gaps", () => {
    expect(() => parseDateTimeLocal("2026-02-30T09:30")).toThrow("valid calendar date");
    expect(() => dateTimeLocalToIso("2026-01-15T09:30", "Not/AZone")).toThrow("Unknown IANA time zone");
    expect(() => dateTimeLocalToIso("2026-03-29T02:30", "Europe/Amsterdam")).toThrow("does not exist");
  });

  it("uses the same conversion in the Worker adapter", () => {
    expect(localDateTimeInTimeZoneToIso("2026-07-15", "09:30", "Europe/Amsterdam")).toBe("2026-07-15T07:30:00.000Z");
    expect(() => localDateTimeInTimeZoneToIso("2026-03-29", "02:30", "Europe/Amsterdam")).toThrowError(
      expect.objectContaining({ code: "INVALID_EVENT_DAY_TIME" }),
    );
  });

  it("accepts explicit calendar parts without normalizing invalid dates", () => {
    expect(
      zonedDateTimeToDate(
        { year: 2026, month: 10, day: 25, hour: 2, minute: 30, second: 0 },
        "Europe/Amsterdam",
      ).toISOString(),
    ).toMatch(/^2026-10-25T0[01]:30:00\.000Z$/);
  });
});
