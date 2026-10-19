import { describe, expect, it } from "vitest";
import {
  clockForZone,
  contractClock,
  eventClock,
  eventClockCity,
  type EventClock,
} from "../../assets/shared/event-clock";
import {
  formatClockName,
  formatDateTimeAtPlace,
  formatDateTimeInZone,
  formatEventWhen,
  formatTimeRangeInZone,
} from "../../assets/shared/format-date";
import { agendaSessionWhen, agendaTimeZones, formatAgendaInstant } from "../../assets/shared/agenda-time-display";

/** Austin 2025 ran on `America/Chicago`: its clock is Austin's, never Chicago's. */
const austin: EventClock = eventClock({ timezone: "America/Chicago", city: "Austin" });
// 15:00Z on 15 January is 09:00 in Austin (CST, UTC−6).
const startsAt = "2025-01-15T15:00:00.000Z";
const endsAt = "2025-01-15T15:45:00.000Z";

describe("an event's clock", () => {
  it("takes its city from the event's own city field, not from the zone", () => {
    expect(austin).toEqual({ timeZone: "America/Chicago", city: "Austin" });
    // The city is taken as entered: no comma parsing, no attendance words stripped.
    expect(eventClockCity(" Kuala Lumpur ")).toBe("Kuala Lumpur");
    expect(eventClockCity("  ")).toBeNull();
    expect(eventClockCity(null)).toBeNull();
    // A meeting series' location is a room or a call, not the city its clock is named by.
    expect(eventClock({ timezone: "Europe/Amsterdam", city: "Amsterdam", seriesId: "series-1" }).city).toBeNull();
  });

  it("names Austin's times 'Austin time' on the Chicago zone's wall clock", () => {
    const range = formatTimeRangeInZone(startsAt, endsAt, austin);
    expect(range).toContain("09:00");
    expect(range).toContain("09:45");
    expect(range).toMatch(/ Austin time$/u);
    expect(range).not.toContain("Chicago");
    expect(formatDateTimeInZone(startsAt, austin)).toMatch(/09:00 Austin time$/u);
    expect(agendaSessionWhen(startsAt, endsAt, austin).time).toBe("09:00–09:45 Austin time");
    expect(formatClockName(austin)).toBe("Austin time");
    expect(formatEventWhen(startsAt, austin, "Austin")).toMatch(/Austin time$/u);
  });

  it("says the city once when the event's place stands beside its time", () => {
    expect(formatDateTimeAtPlace(startsAt, austin, "Austin, United States")).toMatch(/09:00 · Austin, United States$/u);
    expect(formatDateTimeAtPlace(startsAt, austin, "Austin, United States")).not.toContain("Austin time");
    // Without a place beside it, the clock keeps its name.
    expect(formatDateTimeAtPlace(startsAt, austin, null)).toMatch(/09:00 Austin time$/u);
  });

  it("falls back to the zone's city when the event has none", () => {
    const unnamed = eventClock({ timezone: "America/Chicago", city: null });
    expect(formatTimeRangeInZone(startsAt, endsAt, unnamed)).toMatch(/ Chicago time$/u);
    expect(formatDateTimeInZone(startsAt, contractClock({ timeZone: "America/Chicago" }))).toMatch(
      /09:00 Chicago time$/u,
    );
    // UTC is already the name of a clock, whatever city the event is in.
    expect(formatClockName({ timeZone: "UTC", city: "London" })).toBe("UTC");
  });

  it("keeps naming a viewer's own zone by that zone's city", () => {
    const zones = agendaTimeZones(austin, "Asia/Tokyo", "remote");
    expect(zones.primary).toEqual({ zone: "Asia/Tokyo", label: "Your time" });
    expect(formatAgendaInstant(startsAt, zones.primary.zone)).toMatch(/Tokyo time$/u);
    expect(formatAgendaInstant(startsAt, zones.secondary!.zone)).toMatch(/Austin time$/u);
    // A value on another zone than the event's is that zone's own clock.
    expect(clockForZone(austin, "America/Chicago")).toBe(austin);
    expect(clockForZone(austin, "Europe/Amsterdam")).toBe("Europe/Amsterdam");
    expect(clockForZone("America/Chicago", "America/Chicago")).toBe("America/Chicago");
  });
});
