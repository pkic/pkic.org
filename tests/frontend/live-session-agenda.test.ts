import { describe, expect, it } from "vitest";
import {
  liveAgendaDrift,
  liveAgendaDriftText,
  liveSessionTiming,
  liveSessionTimingText,
} from "../../assets/shared/live-session-agenda";

const MINUTE = 60_000;
const now = Date.parse("2026-10-14T12:00:00.000Z");
const at = (minutes: number) => new Date(now + minutes * MINUTE).toISOString();
const session = (start: number, end: number) => ({ startAt: at(start), endAt: at(end) });
const text = (window: { startAt: string; endAt: string }, active: boolean, timer: number | null = null) =>
  liveSessionTimingText(liveSessionTiming(window, now, active, timer), window, "UTC");

describe("a session's timing against now", () => {
  it("counts down to a session that has not started in minutes, hours or days", () => {
    // A session that has not started never shows a whole day left.
    expect(text(session(12, 42), true, 24 * 60 * MINUTE)).toBe("Starts in 12 min");
    expect(text(session(135, 180), false)).toBe("Starts in 2 h 15 min");
    expect(text(session(49 * 24 * 60, 49 * 24 * 60 + 60), true)).toBe("Starts in 49 days");
  });

  it("shows the time left while it runs, by the session timer when it runs", () => {
    expect(text(session(-10, 18.7), true)).toBe("18:42 left");
    expect(text(session(-10, 30), true, 5 * MINUTE)).toBe("05:00 left");
  });

  it("runs over while it is active, and has ended otherwise", () => {
    expect(text(session(-60, -2.25), true)).toBe("+02:15 over");
    expect(text(session(-60, -10), false)).toBe("Ended 10 min ago");
    expect(liveSessionTiming(session(-60, -2), now, true).state).toBe("over");
  });
});

describe("the active session against the agenda", () => {
  const agenda = { ...session(-3, 27), title: "Hybrid certificates" };

  it("says when the agenda moved on while the active session runs over", () => {
    const drift = liveAgendaDrift(session(-45, -3), agenda, now, false);
    expect(drift && liveAgendaDriftText(drift)).toBe("Agenda moved on to “Hybrid certificates” 3 min ago");
  });

  it("says when the next session was made active before its start", () => {
    const drift = liveAgendaDrift(session(5, 35), { ...session(5, 35), title: "Next" }, now, true);
    expect(drift && liveAgendaDriftText(drift)).toBe("Active before its start");
  });

  it("says nothing while the active session is the agenda's, or nothing is active", () => {
    expect(liveAgendaDrift(agenda, agenda, now, true)).toBeNull();
    expect(liveAgendaDrift(null, agenda, now, false)).toBeNull();
  });
});
