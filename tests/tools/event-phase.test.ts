import { describe, expect, it } from "vitest";
import { eventPhase, withinUpcomingEventWindow } from "../../assets/shared/event-phase";

const event = { startsAt: "2026-12-01T09:00:00.000Z", endsAt: "2026-12-03T17:00:00.000Z" };
describe("event timing", () => {
  it.each([
    ["2026-12-01T08:59:59.999Z", "upcoming"],
    ["2026-12-01T09:00:00.000Z", "now"],
    ["2026-12-02T12:00:00.000Z", "now"],
    ["2026-12-03T17:00:00.000Z", "past"],
  ])("classifies an event at %s", (at, phase) => {
    expect(eventPhase(event, Date.parse(at))).toBe(phase);
  });
  it("does not invent an ongoing event from a missing start or end", () => {
    expect(eventPhase({ startsAt: null, endsAt: event.endsAt })).toBeNull();
    expect(eventPhase({ startsAt: event.startsAt, endsAt: null }, Date.parse(event.startsAt))).toBe("past");
  });
});

describe("Upcoming event badge window", () => {
  const now = Date.parse("2026-11-04T12:00:00.000Z");
  it.each([
    ["2026-12-01T09:00:00.000Z", true],
    ["2027-05-04T09:00:00.000Z", true],
    ["2027-05-05T09:00:00.000Z", false],
    ["2027-11-15T09:00:00.000Z", false],
    ["2026-11-03", false],
    [null, false],
  ])("labels %s only within six calendar months", (date, expected) => {
    expect(withinUpcomingEventWindow(date, now)).toBe(expected);
  });
  it("clamps the calendar-month boundary at the end of February", () => {
    const august = Date.parse("2027-08-31T12:00:00.000Z");
    expect(withinUpcomingEventWindow("2028-02-29", august)).toBe(true);
    expect(withinUpcomingEventWindow("2028-03-01", august)).toBe(false);
  });
});
