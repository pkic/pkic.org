import { describe, expect, it } from "vitest";

import {
  countdownLabel,
  eventCountdown,
  greetingFor,
} from "../../assets/ts/member-flows/portal/sections/events/app/event-welcome";

const START = "2026-12-01T08:00:00.000Z";
const END = "2026-12-03T17:00:00.000Z";
const ZONE = "Europe/Amsterdam";

describe("event welcome", () => {
  it("greets by the reader's own hour, night owls included", () => {
    expect([5, 11, 12, 17, 18, 22, 23, 2].map(greetingFor)).toEqual([
      "Good morning",
      "Good morning",
      "Good afternoon",
      "Good afternoon",
      "Good evening",
      "Good evening",
      "Hello, night owl",
      "Hello, night owl",
    ]);
  });

  it("counts down in days, then hours and minutes on the last two days", () => {
    expect(countdownLabel(eventCountdown(Date.parse("2026-11-20T08:00:00.000Z"), START, END, ZONE))).toBe(
      "11 days to go",
    );
    expect(countdownLabel(eventCountdown(Date.parse("2026-11-30T05:30:00.000Z"), START, END, ZONE))).toBe(
      "Starts in 26 h 30 min",
    );
    expect(countdownLabel(eventCountdown(Date.parse("2026-12-01T07:45:00.000Z"), START, END, ZONE))).toBe(
      "Starts in 15 min",
    );
  });

  it("numbers the live day on the event's calendar, and thanks afterwards", () => {
    // 00:30 on 3 December in Amsterdam is still 2 December in UTC: the event's zone decides.
    expect(eventCountdown(Date.parse("2026-12-02T23:30:00.000Z"), START, END, ZONE)).toEqual({
      kind: "live",
      day: 3,
      of: 3,
    });
    expect(countdownLabel(eventCountdown(Date.parse("2026-12-04T09:00:00.000Z"), START, END, ZONE))).toBe(
      "Thank you for being part of it",
    );
    expect(countdownLabel(eventCountdown(Date.now(), null, null, ZONE))).toBeNull();
  });
});
