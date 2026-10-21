import { describe, expect, it, vi } from "vitest";
import {
  dateTimeLocalToIso,
  instantToDateTimeLocal,
  isValidTimeZone,
  parseDateTimeLocal,
  runtimeDatePresentation,
  viewerTimeZone,
  zoneNameAt,
  zonedClock,
  zonedDatePart,
  zonedDateTimeToDate,
  zonedDateTimeParts,
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

describe("shared zone helpers", () => {
  it("recognizes IANA identifiers", () => {
    expect(isValidTimeZone("Europe/Amsterdam")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
  });

  it("names the viewer's zone, never empty", () => {
    expect(viewerTimeZone().length).toBeGreaterThan(0);
    expect(runtimeDatePresentation().timeZone.length).toBeGreaterThan(0);
  });

  it("shows a 24-hour clock in a zone, with midnight as 00", () => {
    expect(zonedClock("2026-07-15T07:05:00.000Z", "Europe/Amsterdam")).toBe("09:05");
    expect(zonedClock(new Date("2026-07-14T22:00:00.000Z"), "Europe/Amsterdam")).toBe("00:00");
    expect(() => zonedClock("2026-07-15T07:05:00.000Z", "Not/AZone")).toThrow();
  });

  it("names a zone at an instant and extracts US English date parts", () => {
    const at = new Date("2026-07-15T12:00:00.000Z");
    expect(zoneNameAt(at, "America/Chicago", "en-US", "short")).toBe("CDT");
    expect(zoneNameAt(at, "Europe/Amsterdam", "en-US", "shortOffset")).toBe("GMT+2");
    expect(zonedDatePart(new Date("2026-12-31T23:30:00.000Z"), "Asia/Tokyo", "year")).toBe("2027");
    expect(zonedDatePart(new Date("2026-12-31T23:30:00.000Z"), "Asia/Tokyo", "month")).toBe("January");
    expect(zonedDatePart(new Date("2026-12-31T23:30:00.000Z"), "Asia/Tokyo", "day")).toBe("1");
  });
});

it("reuses a zone formatter across agenda redraws without freezing its DST offset", () => {
  const constructor = vi.spyOn(Intl, "DateTimeFormat");
  try {
    for (let index = 0; index < 1000; index++) {
      expect(zonedDateTimeParts("2026-01-01T00:00:00.000Z", "Pacific/Chatham").hour).toBe(13);
      expect(zonedDateTimeParts("2026-06-01T00:00:00.000Z", "Pacific/Chatham").hour).toBe(12);
    }
    expect(constructor.mock.calls.length).toBeLessThanOrEqual(1);
  } finally {
    constructor.mockRestore();
  }
});
