import { describe, expect, it } from "vitest";
import ICAL from "ical.js";
import { buildCalendarTimezone } from "../functions/_lib/services/event-series/calendar-timezone";
import { zonedDateTimeParts } from "../assets/shared/timezone";

describe("calendar IANA timezone observances", () => {
  it.each([
    ["Europe/Amsterdam", "2026-03-29T08:00:00.000Z", "2027-11-01T09:00:00.000Z"],
    ["America/New_York", "2026-03-08T14:00:00.000Z", "2027-11-07T15:00:00.000Z"],
    ["Australia/Lord_Howe", "2026-04-05T00:00:00.000Z", "2027-10-03T00:00:00.000Z"],
    ["Asia/Kathmandu", "2026-01-01T04:15:00.000Z", "2027-12-31T04:15:00.000Z"],
    ["UTC", "2026-01-01T10:00:00.000Z", "2027-12-31T10:00:00.000Z"],
  ])("round-trips %s across the calendar horizon", (tzid, ...instants) => {
    const component = buildCalendarTimezone(tzid, "2026-01-01T00:00:00.000Z", "2027-12-31T23:59:59.999Z");
    const parsed = new ICAL.Component(ICAL.parse(component.toString()));
    const zone = new ICAL.Timezone({ component: parsed, tzid });
    for (const instant of instants) {
      const time = ICAL.Time.fromData({ ...zonedDateTimeParts(new Date(instant), tzid), isDate: false }, zone);
      expect(time.toJSDate().toISOString()).toBe(instant);
    }
    expect(component.getAllSubcomponents("standard")).toHaveLength(1);
    expect(component.getAllSubcomponents("daylight").length).toBeLessThanOrEqual(1);
  });
});
