// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { controlLiveTimer, createLiveTimer } from "../../assets/shared/live-timer-policy";
import { EMPTY_LIVE_STAGE } from "../../assets/shared/schemas/live-session-room";
import type { LiveTimer } from "../../assets/shared/schemas/live-session-timer";
import { defaultLiveTimerGraphic, liveTimerSoundSchema } from "../../assets/shared/schemas/live-session-timer";
import { LiveOverlayPresentation } from "../../assets/ts/live-session/LiveOverlayPresentation";
import { liveTimerCueWav } from "../../assets/ts/live-session/live-timer-sound";
import { LiveClockContext } from "../../assets/ts/live-session/useLiveCountdown";
import { LiveTimerSounds } from "../../assets/ts/live-session/useLiveTimerSounds";
import { timersRoomState } from "../../assets/ts/ui/preview/studio-timers-fixtures";

const start = Date.parse("2026-12-01T10:00:00.000Z");
const session = { startAt: "2026-12-01T09:30:00.000Z", endAt: "2026-12-01T10:30:00.000Z" };
let now = start;
const clock = () => now;
let host: HTMLElement | undefined;
let played: string[] = [];

/** A one-minute pitch, started at `start`, that chimes with 30 s left and buzzes at zero when its sounds are on. */
function pitch(sounds = true, atZero: LiveTimer["atZero"]["action"] = "overtime"): LiveTimer {
  const timer = createLiveTimer(
    "pitch",
    { name: "Pitch", kind: "duration", targetAt: null, durationSeconds: 60 },
    session,
    start,
  );
  return controlLiveTimer(
    {
      ...timer,
      atZero: { action: atZero, resetAfterSeconds: 10, restart: true },
      sound: sounds ? { warningSeconds: 30, zero: true } : { warningSeconds: null, zero: false },
    },
    session,
    "start",
    start,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  now = start;
  played = [];
  // The page plays through a plain audio element; record which clip it was given.
  let next = 0;
  URL.createObjectURL = () => `blob:clip-${(next += 1)}`;
  vi.stubGlobal(
    "Audio",
    class {
      constructor(readonly src: string) {}
      play() {
        played.push(this.src);
        // A browser that was never clicked refuses; the page stays quiet about it.
        return Promise.reject(new DOMException("Blocked", "NotAllowedError"));
      }
    },
  );
});

afterEach(async () => {
  if (host) await act(() => render(null, host!));
  host?.remove();
  host = undefined;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function mount(view: preact.ComponentChildren) {
  host ??= document.body.appendChild(document.createElement("div"));
  await act(() => render(<LiveClockContext.Provider value={clock}>{view}</LiveClockContext.Provider>, host!));
}

/** Moves the page's clock on in steps, letting its checks run. */
async function advance(milliseconds: number, rerender?: () => Promise<void>) {
  for (let step = 0; step < milliseconds; step += 250) {
    now += 250;
    await act(() => {
      vi.advanceTimersByTime(250);
    });
    if (rerender) await rerender();
  }
}

it("plays the chime and the buzzer once each, however often the page renders", async () => {
  const timer = pitch();
  const draw = () => mount(<LiveTimerSounds timers={[{ ...timer }]} session={session} />);
  await draw();
  await advance(75_000, draw);
  expect(played).toEqual(["blob:clip-1", "blob:clip-2"]);
});

it("plays every round of a pitch that resets and starts again", async () => {
  await mount(<LiveTimerSounds timers={[pitch(true, "reset")]} session={session} />);
  // Zero at 60 s and 130 s, warnings at 30 s and 100 s.
  await advance(135_000);
  expect(played).toHaveLength(4);
});

it("sounds on Program for the timers Program shows; a timer saved without a place to sound stays silent", async () => {
  expect(liveTimerSoundSchema.parse({ places: [], warningSeconds: 60, zero: true })).toEqual({
    warningSeconds: null,
    zero: false,
  });
  expect(liveTimerSoundSchema.parse({ places: ["stage-display"], warningSeconds: 60, zero: true })).toEqual({
    warningSeconds: 60,
    zero: true,
  });
  const state = timersRoomState([pitch()], [], {
    stage: { ...EMPTY_LIVE_STAGE, timerGraphics: [defaultLiveTimerGraphic("pitch")] },
  });
  await mount(
    <LiveOverlayPresentation
      view="program"
      playsSounds
      projection={{ ...state, session: { ...state.session, ...session } }}
    />,
  );
  await advance(65_000);
  expect(played).toHaveLength(2);
});

it("stays silent for a timer without sounds, and for a crossing it slept through", async () => {
  await mount(<LiveTimerSounds timers={[pitch(false)]} session={session} />);
  await advance(65_000);
  expect(played).toEqual([]);
  await act(() => render(null, host!));
  now = start;
  await mount(<LiveTimerSounds timers={[pitch()]} session={session} />);
  now += 40_000;
  await act(() => {
    vi.advanceTimersByTime(250);
  });
  expect(played).toEqual([]);
});

it("sounds on a real output for the timers it shows, never on a monitor of it", async () => {
  const state = timersRoomState([pitch()], [defaultLiveTimerGraphic("pitch")]);
  await mount(
    <LiveOverlayPresentation
      view="stage-display"
      projection={{ ...state, session: { ...state.session, ...session } }}
    />,
  );
  await advance(65_000);
  expect(played).toEqual([]);
  await mount(
    <LiveOverlayPresentation
      view="stage-display"
      playsSounds
      projection={{ ...state, session: { ...state.session, ...session } }}
    />,
  );
  now = start;
  await advance(65_000);
  expect(played).toHaveLength(2);
  const hidden = timersRoomState([pitch()], []);
  await mount(<LiveOverlayPresentation view="stage-display" playsSounds projection={hidden} />);
  played = [];
  now = start;
  await advance(65_000);
  expect(played).toEqual([]);
});

it("draws each cue as a playable WAV clip", () => {
  for (const cue of ["warning", "zero"] as const) {
    const header = new TextDecoder().decode(new Uint8Array(liveTimerCueWav(cue)).slice(0, 12));
    expect(header).toBe(`RIFF${header.slice(4, 8)}WAVE`);
  }
});
