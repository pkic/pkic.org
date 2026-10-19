import { describe, expect, it } from "vitest";
import { eventPhase } from "../../assets/shared/event-phase";

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
