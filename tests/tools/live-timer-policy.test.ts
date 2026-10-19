import { describe, expect, it } from "vitest";
import {
  adjustLiveTimer,
  updateLiveTimerGraphics,
  controlLiveTimer,
  createLiveTimer,
  formatLiveTimer,
  liveTimerShownMs,
  liveTimerTone,
  liveTimerValue,
  sessionLiveTimer,
} from "../../assets/shared/live-timer-policy";
import { defaultLiveTimerGraphic, liveTimerSchema } from "../../assets/shared/schemas/live-session-timer";

const now = Date.parse("2026-10-12T10:00:00.000Z");
const at = (ms: number) => new Date(now + ms).toISOString();
const session = { startAt: at(-600_000), endAt: at(3_000_000) };

describe("live room timer policy", () => {
  it("follows the session's end on the agenda and returns to it on reset", () => {
    const timer = sessionLiveTimer(session);
    expect(liveTimerSchema.parse(timer)).toMatchObject({ running: true, anchorAt: session.endAt });
    expect(liveTimerValue(timer, now)).toBe(3_000_000);
    const paused = controlLiveTimer(timer, session, "pause", now + 60_000);
    expect(paused).toMatchObject({ running: false, anchorAt: null, heldMs: 2_940_000 });
    const resumed = controlLiveTimer(adjustLiveTimer(paused, 60, now + 120_000), session, "start", now + 120_000);
    expect(liveTimerValue(resumed, now + 120_000)).toBe(3_000_000);
    expect(controlLiveTimer(resumed, session, "reset", now + 200_000)).toMatchObject({ anchorAt: session.endAt });
  });

  it("counts a fixed length down once started, and over time below zero", () => {
    const pitch = createLiveTimer(
      "pitch",
      { name: "Pitch", kind: "duration", targetAt: null, durationSeconds: 60 },
      session,
      now,
    );
    expect(pitch).toMatchObject({ running: false, heldMs: 60_000 });
    const started = controlLiveTimer(pitch, session, "start", now);
    expect(liveTimerValue(started, now + 75_000)).toBe(-15_000);
    expect(formatLiveTimer(liveTimerValue(started, now + 75_000), "mm:ss")).toBe("+00:15");
    expect(controlLiveTimer(started, session, "reset", now + 75_000)).toMatchObject({ running: false, heldMs: 60_000 });
  });

  it("counts down to a time on the event clock and up from zero as a stopwatch", () => {
    const doors = createLiveTimer(
      "doors",
      { name: "Doors", kind: "until", targetAt: at(900_000), durationSeconds: null },
      session,
      now,
    );
    expect(doors).toMatchObject({ running: true, anchorAt: at(900_000), durationSeconds: 900 });
    const watch = controlLiveTimer(
      createLiveTimer(
        "watch",
        { name: "Break", kind: "stopwatch", targetAt: null, durationSeconds: null },
        session,
        now,
      ),
      session,
      "start",
      now,
    );
    expect(liveTimerValue(watch, now + 61_000)).toBe(61_000);
    expect(liveTimerValue(adjustLiveTimer(watch, -120, now + 61_000), now + 61_000)).toBe(0);
  });

  it("supports hours, minutes, total seconds and long custom duration tokens", () => {
    expect(formatLiveTimer(3723000, "hh:mm:ss")).toBe("01:02:03");
    expect(formatLiveTimer(3723000, "mm:ss")).toBe("62:03");
    expect(formatLiveTimer(-3723000, "ss")).toBe("+3723");
    const span = (365 * 86400 + 2 * 30 * 86400 + 5 * 86400 + 3 * 3600 + 20 * 60 + 10) * 1000;
    expect(
      formatLiveTimer(
        span,
        "custom",
        "{{years}} year, {{months}} months, {{days}} days, {{hours}} hours, {{minutes}} minutes and {{seconds}} seconds",
      ),
    ).toBe("1 year, 2 months, 5 days, 3 hours, 20 minutes and 10 seconds");
  });
  it("changes one graphic without removing or reordering the others", () => {
    const sessionGraphic = defaultLiveTimerGraphic("session"),
      pitch = defaultLiveTimerGraphic("pitch");
    const both = updateLiveTimerGraphics([sessionGraphic], pitch, true);
    expect(both).toEqual([sessionGraphic, pitch]);
    const updated = { ...sessionGraphic, showLogo: false };
    expect(updateLiveTimerGraphics(both, updated, true)).toEqual([updated, pitch]);
    expect(updateLiveTimerGraphics(both, pitch, false)).toEqual([sessionGraphic]);
  });
  it("draws the graphic in its format, direction and thresholds", () => {
    const pitch = controlLiveTimer(
      createLiveTimer("pitch", { name: "Pitch", kind: "duration", targetAt: null, durationSeconds: 600 }, session, now),
      session,
      "start",
      now,
    );
    const graphic = { ...defaultLiveTimerGraphic("pitch"), warningSeconds: 60, overrunSeconds: 30 };
    expect(formatLiveTimer(liveTimerShownMs(pitch, graphic, session, now + 90_000), "hh:mm:ss")).toBe("00:08:30");
    expect(liveTimerShownMs(pitch, { direction: "elapsed" }, session, now + 90_000)).toBe(90_000);
    expect(liveTimerTone(pitch, 61_000, graphic)).toBeUndefined();
    expect(liveTimerTone(pitch, 60_000, graphic)).toBe("warn");
    expect(liveTimerTone(pitch, -29_000, graphic)).toBe("warn");
    expect(liveTimerTone(pitch, -30_000, graphic)).toBe("over");
    expect(liveTimerTone({ kind: "stopwatch" }, -60_000, graphic)).toBeUndefined();
  });
});
