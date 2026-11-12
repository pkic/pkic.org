import { describe, expect, it } from "vitest";
import {
  adjustLiveTimer,
  configureLiveTimer,
  controlLiveTimer,
  createLiveTimer,
  editLiveTimer,
  liveTimerCue,
  liveTimerReading,
  liveTimerShownMs,
  liveTimerTone,
  sessionLiveTimer,
  settleLiveTimer,
  updateLiveTimerGraphics,
} from "../../assets/shared/live-timer-policy";
import { format24HourClockInZone } from "../../assets/shared/format-date";
import { formatLiveDuration, formatLiveTimer } from "../../assets/shared/live-timer-format";
import {
  DEFAULT_LIVE_TIMER_SOUND,
  defaultLiveTimerGraphic,
  liveTimerSchema,
  type LiveTimer,
} from "../../assets/shared/schemas/live-session-timer";

const now = Date.parse("2026-10-12T10:00:00.000Z");
const at = (ms: number) => new Date(now + ms).toISOString();
const MINUTE = 60_000;
/** A 30-minute session that starts in 19 days. */
const future = { startAt: at(19 * 24 * 60 * MINUTE), endAt: at(19 * 24 * 60 * MINUTE + 30 * MINUTE) };
/** A 60-minute session under way for ten minutes. */
const session = { startAt: at(-10 * MINUTE), endAt: at(50 * MINUTE) };
const read = (timer: LiveTimer, window: typeof session, when: number) => liveTimerReading(timer, window, when);

const pitch = (atZero: LiveTimer["atZero"]) =>
  controlLiveTimer(
    {
      ...createLiveTimer(
        "pitch",
        { name: "Pitch", kind: "duration", targetAt: null, durationSeconds: 60 },
        session,
        now,
      ),
      atZero,
    },
    session,
    "start",
    now,
  );

describe("a session timer that follows the agenda", () => {
  it("shows the time until its session starts, not a countdown to its end", () => {
    const timer = sessionLiveTimer();
    expect(liveTimerSchema.parse(timer)).toMatchObject({ followsAgenda: true, running: false, anchorAt: null });
    expect(read(timer, future, now)).toEqual({
      valueMs: 30 * MINUTE,
      running: false,
      startsInMs: 19 * 24 * 60 * MINUTE,
      ticking: true,
    });
    expect(liveTimerShownMs(timer, defaultLiveTimerGraphic("session"), future, now)).toBe(19 * 24 * 60 * MINUTE);
  });

  it("counts the session down from its start, and over once it ends", () => {
    const timer = sessionLiveTimer();
    expect(read(timer, session, now)).toEqual({ valueMs: 50 * MINUTE, running: true, startsInMs: null, ticking: true });
    expect(read(timer, session, now + 55 * MINUTE).valueMs).toBe(-5 * MINUTE);
  });

  it("starts from its full length when an operator starts it before its session", () => {
    const started = controlLiveTimer(sessionLiveTimer(), future, "start", now);
    expect(started).toMatchObject({ followsAgenda: false, running: true, anchorAt: at(30 * MINUTE) });
    expect(read(started, future, now + MINUTE)).toMatchObject({ valueMs: 29 * MINUTE, startsInMs: null });
  });

  it("leaves the agenda when an operator starts it during its session", () => {
    const started = controlLiveTimer(sessionLiveTimer(), session, "start", now);
    expect(started).toMatchObject({ followsAgenda: false, running: true, anchorAt: session.endAt });
  });

  it("pauses, resets to its full length stopped, and follows the agenda again", () => {
    const paused = controlLiveTimer(sessionLiveTimer(), session, "pause", now + MINUTE);
    expect(paused).toMatchObject({ followsAgenda: false, running: false, heldMs: 49 * MINUTE });
    expect(read(paused, session, now + 5 * MINUTE)).toMatchObject({ valueMs: 49 * MINUTE, ticking: false });
    const nudged = adjustLiveTimer(paused, session, 60, now + 5 * MINUTE);
    expect(nudged).toMatchObject({ running: false, heldMs: 50 * MINUTE });
    const reset = controlLiveTimer(nudged, session, "reset", now + 6 * MINUTE);
    expect(reset).toMatchObject({ followsAgenda: false, running: false, anchorAt: null, heldMs: 60 * MINUTE });
    expect(controlLiveTimer(reset, session, "follow", now)).toMatchObject({ followsAgenda: true, heldMs: 0 });
  });

  it("takes a minute while running and leaves the agenda for the operators' clock", () => {
    const taken = adjustLiveTimer(sessionLiveTimer(), session, -60, now);
    expect(taken).toMatchObject({ followsAgenda: false, running: true, anchorAt: at(49 * MINUTE) });
  });

  it("stops at zero when told to, instead of counting over", () => {
    const timer = { ...sessionLiveTimer(), atZero: { action: "stop" as const, resetAfterSeconds: 10, restart: false } };
    expect(read(timer, session, now + 55 * MINUTE)).toEqual({
      valueMs: 0,
      running: false,
      startsInMs: null,
      ticking: false,
    });
  });
});

describe("a countdown just started", () => {
  it("never reads more than it had when it was started, on a screen whose clock runs behind", () => {
    const started = {
      ...pitch({ action: "overtime", resetAfterSeconds: 10, restart: false }),
      change: { operatorName: "Op", at: at(0) },
    };
    // The screen's clock is 400 ms behind the room's: without the cap it would read 1:00.4, so 1:01.
    expect(read(started, session, now - 400).valueMs).toBe(60_000);
    expect(read(started, session, now + 1_000).valueMs).toBe(59_000);
  });
});

describe("a countdown at zero", () => {
  it("keeps counting as overtime by default", () => {
    const timer = pitch({ action: "overtime", resetAfterSeconds: 10, restart: false });
    expect(read(timer, session, now + 75_000)).toMatchObject({ valueMs: -15_000, running: true });
    expect(controlLiveTimer(timer, session, "reset", now + 75_000)).toMatchObject({ running: false, heldMs: 60_000 });
  });

  it("stops at zero and settles there for the next command", () => {
    const timer = pitch({ action: "stop", resetAfterSeconds: 10, restart: false });
    expect(read(timer, session, now + 59_000)).toMatchObject({ valueMs: 1_000, running: true });
    expect(read(timer, session, now + 75_000)).toEqual({
      valueMs: 0,
      running: false,
      startsInMs: null,
      ticking: false,
    });
    expect(settleLiveTimer(timer, session, now + 75_000)).toMatchObject({ running: false, heldMs: 0 });
    expect(controlLiveTimer(timer, session, "pause", now + 75_000)).toMatchObject({ running: false, heldMs: 0 });
    // Start at zero begins a new countdown from the full length.
    const again = controlLiveTimer(timer, session, "start", now + 75_000);
    expect(read(again, session, now + 75_000)).toMatchObject({ valueMs: 60_000, running: true });
  });

  it("resets to its full length after the seconds over, and waits there", () => {
    const timer = pitch({ action: "reset", resetAfterSeconds: 10, restart: false });
    expect(read(timer, session, now + 69_999).valueMs).toBe(-9_999);
    expect(read(timer, session, now + 70_000)).toEqual({
      valueMs: 60_000,
      running: false,
      startsInMs: null,
      ticking: false,
    });
    // Start from the wait runs the next pitch from its full length.
    const next = controlLiveTimer(timer, session, "start", now + 90_000);
    expect(read(next, session, now + 100_000).valueMs).toBe(50_000);
  });

  it("resets and starts the next round right away, round after round", () => {
    const timer = pitch({ action: "reset", resetAfterSeconds: 10, restart: true });
    // Round one ends at 60 s and resets at 70 s; round two ends at 130 s and resets at 140 s.
    expect(read(timer, session, now + 70_000)).toMatchObject({ valueMs: 60_000, running: true });
    expect(read(timer, session, now + 100_000).valueMs).toBe(30_000);
    expect(read(timer, session, now + 135_000).valueMs).toBe(-5_000);
    expect(read(timer, session, now + 140_000).valueMs).toBe(60_000);
    expect(settleLiveTimer(timer, session, now + 145_000)).toMatchObject({ running: true, anchorAt: at(200_000) });
  });

  it("resets the moment it reaches zero when no seconds over are allowed", () => {
    const timer = pitch({ action: "reset", resetAfterSeconds: 0, restart: false });
    expect(read(timer, session, now + 60_000)).toMatchObject({ valueMs: 60_000, running: false });
  });

  it("keeps what old settings did when new ones arrive, and refuses a reset where there is no length", () => {
    const timer = pitch({ action: "reset", resetAfterSeconds: 10, restart: false });
    const changed = configureLiveTimer(
      timer,
      session,
      { atZero: { action: "overtime", resetAfterSeconds: 10, restart: false }, sound: DEFAULT_LIVE_TIMER_SOUND },
      now + 80_000,
    );
    expect(changed).toMatchObject({ running: false, heldMs: 60_000, atZero: { action: "overtime" } });
    const reset = {
      atZero: { action: "reset" as const, resetAfterSeconds: 5, restart: true },
      sound: DEFAULT_LIVE_TIMER_SOUND,
    };
    expect(configureLiveTimer(sessionLiveTimer(), session, reset, now)).toBeNull();
    const watch = createLiveTimer(
      "w",
      { name: "Break", kind: "stopwatch", targetAt: null, durationSeconds: null },
      session,
      now,
    );
    expect(
      configureLiveTimer(watch, session, { ...reset, atZero: { ...reset.atZero, action: "stop" } }, now),
    ).toBeNull();
    expect(() => liveTimerSchema.parse({ ...sessionLiveTimer(), atZero: reset.atZero })).toThrow();
  });
});

describe("editing a timer", () => {
  const overtime = { action: "overtime" as const, resetAfterSeconds: 10, restart: false };
  const value = (timer: LiveTimer, when: number) => read(timer, session, when).valueMs;

  it("renames any timer, and gives a countdown at its full length or at zero the new length", () => {
    const ready = createLiveTimer(
      "pitch",
      { name: "Pitch", kind: "duration", targetAt: null, durationSeconds: 180 },
      session,
      now,
    );
    const longer = editLiveTimer(ready, session, { name: "Startup pitch", durationSeconds: 240 }, now)!;
    expect(longer).toMatchObject({ name: "Startup pitch", durationSeconds: 240, running: false, heldMs: 240_000 });
    const stoppedAtZero = { ...ready, heldMs: 0 };
    expect(editLiveTimer(stoppedAtZero, session, { durationSeconds: 120 }, now)).toMatchObject({ heldMs: 120_000 });
    expect(editLiveTimer(sessionLiveTimer(), session, { name: "Keynote" }, now)).toMatchObject({ name: "Keynote" });
  });

  it("moves the time left of a countdown that has begun by the difference, running or paused", () => {
    // One minute long, 20 s in: 40 s left; at three minutes long, 2:40 left.
    const running = pitch(overtime);
    const edited = editLiveTimer(running, session, { durationSeconds: 180 }, now + 20_000)!;
    expect(edited.running).toBe(true);
    expect(value(edited, now + 20_000)).toBe(160_000);
    const paused = controlLiveTimer(running, session, "pause", now + 20_000);
    expect(editLiveTimer(paused, session, { durationSeconds: 30 }, now + 30_000)).toMatchObject({
      running: false,
      heldMs: 10_000,
    });
  });

  it("counts a countdown to a time to the new time, held if paused, and refuses a time that has passed", () => {
    const doors = createLiveTimer(
      "doors",
      { name: "Doors", kind: "until", targetAt: at(900_000), durationSeconds: null },
      session,
      now,
    );
    expect(editLiveTimer(doors, session, { targetAt: at(1_200_000) }, now)).toMatchObject({
      running: true,
      anchorAt: at(1_200_000),
      targetAt: at(1_200_000),
      durationSeconds: 1200,
    });
    const paused = controlLiveTimer(doors, session, "pause", now);
    expect(editLiveTimer(paused, session, { targetAt: at(600_000) }, now)).toMatchObject({
      running: false,
      heldMs: 600_000,
    });
    expect(editLiveTimer(doors, session, { targetAt: at(-60_000) }, now)).toBeNull();
    expect(editLiveTimer(doors, session, { durationSeconds: 60 }, now)).toBeNull();
  });
});

describe("other kinds", () => {
  it("counts down to a time on the event clock, and resets to count to it again", () => {
    const doors = createLiveTimer(
      "doors",
      { name: "Doors", kind: "until", targetAt: at(900_000), durationSeconds: null },
      session,
      now,
    );
    expect(doors).toMatchObject({ running: true, anchorAt: at(900_000), durationSeconds: 900 });
    const paused = controlLiveTimer(doors, session, "pause", now + 60_000);
    expect(controlLiveTimer(paused, session, "reset", now + 120_000)).toMatchObject({
      running: true,
      anchorAt: at(900_000),
    });
    // Once the time has passed, reset stops at zero instead of rearming to the past.
    expect(controlLiveTimer(paused, session, "reset", now + 960_000)).toMatchObject({ running: false, heldMs: 0 });
  });

  it("counts up as a stopwatch, never below zero, and resets to zero", () => {
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
    expect(read(watch, session, now + 61_000).valueMs).toBe(61_000);
    expect(read(adjustLiveTimer(watch, session, -120, now + 61_000), session, now + 61_000).valueMs).toBe(0);
    expect(controlLiveTimer(watch, session, "reset", now)).toMatchObject({ running: false, heldMs: 0 });
  });
});

describe("a clock", () => {
  const clock = createLiveTimer(
    "clock",
    { name: "Clock", kind: "clock", targetAt: null, durationSeconds: null },
    session,
    now,
  );

  it("moves with the time of day and has nothing to start, reset, adjust, warn about or sound", () => {
    expect(read(clock, session, now)).toEqual({ valueMs: 0, running: false, startsInMs: null, ticking: true });
    for (const action of ["start", "pause", "reset"] as const)
      expect(controlLiveTimer(clock, session, action, now)).toBe(clock);
    expect(adjustLiveTimer(clock, session, 60, now)).toBe(clock);
    expect(liveTimerTone(clock, 0, defaultLiveTimerGraphic("clock"))).toBeUndefined();
    expect(
      configureLiveTimer(clock, session, { atZero: clock.atZero, sound: { ...clock.sound, places: ["studio"] } }, now),
    ).toBeNull();
    expect(
      liveTimerCue({ ...clock, sound: { ...clock.sound, places: ["studio"] } }, session, now - 86_400_000, now),
    ).toBeNull();
  });

  it("reads HH:mm on the event's 24-hour clock, whatever zone it runs in", () => {
    const instant = Date.parse("2026-12-01T09:05:00.000Z");
    expect(format24HourClockInZone(instant, "Europe/Amsterdam")).toBe("10:05");
    expect(format24HourClockInZone(instant, "America/Toronto")).toBe("04:05");
    expect(format24HourClockInZone(instant, "Asia/Kolkata")).toBe("14:35");
    // Midnight is 00:00, never 24:00, and the afternoon never reads as 12-hour.
    expect(format24HourClockInZone(Date.parse("2026-12-01T23:00:00.000Z"), "Europe/Amsterdam")).toBe("00:00");
    expect(format24HourClockInZone(Date.parse("2026-12-01T14:30:00.000Z"), "Europe/Amsterdam")).toBe("15:30");
    // Across the spring clock change in Amsterdam: 01:59 CET, then 03:00 CEST.
    expect(format24HourClockInZone(Date.parse("2026-03-29T00:59:00.000Z"), "Europe/Amsterdam")).toBe("01:59");
    expect(format24HourClockInZone(Date.parse("2026-03-29T01:00:00.000Z"), "Europe/Amsterdam")).toBe("03:00");
  });
});

describe("timer sounds", () => {
  const sounding = (timer: LiveTimer): LiveTimer => ({
    ...timer,
    sound: { places: ["outputs"], warningSeconds: 30, zero: true },
  });

  it("chimes at the warning and buzzes at zero, each once as time runs past it", () => {
    const timer = sounding(pitch({ action: "overtime", resetAfterSeconds: 10, restart: false }));
    // Checked every quarter second for two minutes, the countdown asks for exactly two cues.
    const cues = Array.from({ length: 480 }, (_, index) =>
      liveTimerCue(timer, session, now + index * 250, now + (index + 1) * 250),
    ).flatMap((cue, index) => (cue ? [{ cue, at: (index + 1) * 250 }] : []));
    expect(cues).toEqual([
      { cue: "warning", at: 30_000 },
      { cue: "zero", at: 60_000 },
    ]);
  });

  it("buzzes every round of a pitch that restarts itself, and at a reset with no seconds over", () => {
    const timer = sounding(pitch({ action: "reset", resetAfterSeconds: 10, restart: true }));
    const zeros = Array.from({ length: 200 }, (_, index) =>
      liveTimerCue(timer, session, now + index * 1000, now + (index + 1) * 1000),
    ).filter((cue) => cue === "zero");
    // Zero at 60 s, 130 s and 200 s.
    expect(zeros).toHaveLength(3);
    const instant = sounding(pitch({ action: "reset", resetAfterSeconds: 0, restart: false }));
    expect(liveTimerCue(instant, session, now + 59_750, now + 60_000)).toBe("zero");
  });

  it("stays silent while paused, for a jump past a point, and before an agenda session starts", () => {
    const timer = sounding(pitch({ action: "overtime", resetAfterSeconds: 10, restart: false }));
    const paused = controlLiveTimer(timer, session, "pause", now + 20_000);
    expect(liveTimerCue(paused, session, now + 20_000, now + 120_000)).toBeNull();
    // Taking a minute at 20 s left puts zero 40 s in the past: no buzzer for the jump.
    const jumped = adjustLiveTimer(timer, session, -60, now + 40_000);
    expect(liveTimerCue(jumped, session, now + 40_000, now + 41_000)).toBeNull();
    const agenda = sounding(sessionLiveTimer());
    const short = { startAt: at(10_000), endAt: at(20_000) };
    // A warning that would fall before the session starts never plays; zero still does.
    expect(liveTimerCue(agenda, short, now, now + 15_000)).toBeNull();
    expect(liveTimerCue(agenda, short, now + 15_000, now + 20_000)).toBe("zero");
  });

  it("plays no buzzer when only the chime is wanted", () => {
    const timer = { ...pitch({ action: "overtime", resetAfterSeconds: 10, restart: false }) };
    const chimeOnly = { ...timer, sound: { places: ["studio" as const], warningSeconds: 30, zero: false } };
    expect(liveTimerCue(chimeOnly, session, now + 59_000, now + 61_000)).toBeNull();
    expect(liveTimerCue(chimeOnly, session, now + 29_000, now + 31_000)).toBe("warning");
  });
});

describe("the shared clock format", () => {
  it.each([
    [0, "0:00"],
    [9_000, "0:09"],
    [245_000, "4:05"],
    [3_599_000, "59:59"],
    [3_600_000, "1:00:00"],
    [3_723_000, "1:02:03"],
    [86_399_000, "23:59:59"],
    [86_400_000, "1d 00:00"],
    [(3 * 86400 + 4 * 3600 + 12 * 60) * 1000, "3d 04:12"],
    [(19 * 86400 + 22 * 3600 + 30 * 60) * 1000, "19d 22:30"],
    [(364 * 86400 + 23 * 3600) * 1000, "364d 23:00"],
    [365 * 86_400_000, "1y 0d"],
    [(4 * 365 + 210) * 86_400_000, "4y 210d"],
  ])("reads %i ms as %s", (milliseconds, text) => {
    expect(formatLiveDuration(milliseconds)).toBe(text);
  });

  it("rounds a countdown up to the second, so it reads 0:01 until it is over", () => {
    expect(formatLiveDuration(400)).toBe("0:01");
    expect(formatLiveDuration((86_400 + 30) * 1000)).toBe("1d 00:01");
  });

  it("marks time over with a plus at every range", () => {
    expect(formatLiveDuration(-15_000)).toBe("+0:15");
    expect(formatLiveDuration(-62_481_000)).toBe("+17:21:21");
    expect(formatLiveDuration(-2 * 86_400_000)).toBe("+2d 00:00");
    expect(formatLiveDuration(-2 * 365 * 86_400_000)).toBe("+2y 0d");
  });

  it("reads a graphic's clock, total seconds and long custom duration tokens", () => {
    expect(formatLiveTimer(3_723_000, "clock")).toBe("1:02:03");
    expect(formatLiveTimer(-3_723_000, "ss")).toBe("+3,723");
    const span = (365 * 86400 + 2 * 30 * 86400 + 5 * 86400 + 3 * 3600 + 20 * 60 + 10) * 1000;
    expect(
      formatLiveTimer(
        span,
        "custom",
        "{{years}} year, {{months}} months, {{days}} days, {{hours}} hours, {{minutes}} minutes and {{seconds}} seconds",
      ),
    ).toBe("1 year, 2 months, 5 days, 3 hours, 20 minutes and 10 seconds");
  });
});

describe("the timer graphic", () => {
  it("changes one graphic without removing or reordering the others", () => {
    const sessionGraphic = defaultLiveTimerGraphic("session"),
      other = defaultLiveTimerGraphic("pitch");
    const both = updateLiveTimerGraphics([sessionGraphic], other, true);
    expect(both).toEqual([sessionGraphic, other]);
    const updated = { ...sessionGraphic, showLogo: false };
    expect(updateLiveTimerGraphics(both, updated, true)).toEqual([updated, other]);
    expect(updateLiveTimerGraphics(both, other, false)).toEqual([sessionGraphic]);
  });

  it("draws the graphic in its direction and thresholds", () => {
    const timer = controlLiveTimer(
      createLiveTimer("pitch", { name: "Pitch", kind: "duration", targetAt: null, durationSeconds: 600 }, session, now),
      session,
      "start",
      now,
    );
    const graphic = { ...defaultLiveTimerGraphic("pitch"), warningSeconds: 60, overrunSeconds: 30 };
    expect(formatLiveTimer(liveTimerShownMs(timer, graphic, session, now + 90_000), "clock")).toBe("8:30");
    expect(liveTimerShownMs(timer, { direction: "elapsed" }, session, now + 90_000)).toBe(90_000);
    expect(liveTimerTone(timer, 61_000, graphic)).toBeUndefined();
    expect(liveTimerTone(timer, 60_000, graphic)).toBe("warn");
    expect(liveTimerTone(timer, -29_000, graphic)).toBe("warn");
    expect(liveTimerTone(timer, -30_000, graphic)).toBe("over");
    expect(liveTimerTone({ kind: "stopwatch" }, -60_000, graphic)).toBeUndefined();
  });
});
