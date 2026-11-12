// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultLiveTimerGraphic } from "../../assets/shared/schemas/live-session-timer";
import { createScreenClock, screenClockSample } from "../../assets/ts/event-screens/screen-clock";
import { LiveOverlayPresentation } from "../../assets/ts/live-session/LiveOverlayPresentation";
import type { LiveRoomState } from "../../assets/ts/live-session/live-room-state";
import { LiveClockContext } from "../../assets/ts/live-session/useLiveCountdown";
import { stageClockState } from "../../assets/ts/ui/preview/studio-timers-fixtures";

/** The device runs three minutes and twenty seconds slow against the server. */
const DEVICE_NOW = Date.parse("2026-11-12T09:56:40.000Z");
const SERVER_NOW = Date.parse("2026-11-12T10:00:00.000Z");
let host: HTMLElement | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(DEVICE_NOW);
});
afterEach(async () => {
  if (host) await act(() => render(null, host!));
  host?.remove();
  host = undefined;
  vi.useRealTimers();
});

/** The screen's clock after one exchange with the server, as a venue screen keeps it. */
function syncedClock() {
  const clock = createScreenClock();
  clock.record(screenClockSample(DEVICE_NOW - 50, DEVICE_NOW + 50, new Date(SERVER_NOW).toISOString()));
  return clock;
}

async function draw(state: LiveRoomState, now: () => number) {
  host ??= document.body.appendChild(document.createElement("div"));
  await act(() =>
    render(
      <LiveClockContext.Provider value={now}>
        <LiveOverlayPresentation view="stage-display" projection={state} />
      </LiveClockContext.Provider>,
      host!,
    ),
  );
  return {
    clock: () => host!.querySelector(".pk-live-stage-display__clock-time")?.textContent,
    countdowns: () => [...host!.querySelectorAll(".pk-live-stage-display__countdown")].map((node) => node.textContent),
  };
}

it("reads the server's time on the event's clock, not the device's time or zone", async () => {
  const shown = await draw(stageClockState, syncedClock().now);
  // 10:00 UTC is 11:00 in Amsterdam, the event's zone; the slow device would say 10:56.
  expect(shown.clock()).toBe("11:00");
  // The session timer beside it counts on the same clock: its session ends at 10:15 UTC.
  expect(shown.countdowns()[0]).toBe("15:00");
  const inToronto = { ...stageClockState, session: { ...stageClockState.session, timeZone: "America/Toronto" } };
  expect((await draw(inToronto, syncedClock().now)).clock()).toBe("05:00");
});

it("moves on with the synced clock while the countdowns keep pace", async () => {
  const shown = await draw(stageClockState, syncedClock().now);
  await act(() => {
    vi.advanceTimersByTime(60_000);
  });
  expect(shown.clock()).toBe("11:01");
  expect(shown.countdowns()[0]).toBe("14:00");
});

it("shows the clock under the countdowns, which keep their grid to themselves", async () => {
  const shown = await draw(stageClockState, syncedClock().now);
  expect(shown.countdowns()).toHaveLength(2);
  const clockOnly = timersOn(stageClockState, ["clock"]);
  const alone = await draw(clockOnly, syncedClock().now);
  expect(alone.countdowns()).toEqual([]);
  expect(alone.clock()).toBe("11:00");
});

const timersOn = (state: LiveRoomState, ids: string[]): LiveRoomState => ({
  ...state,
  outputs: {
    ...state.outputs,
    "stage-display": { ...state.outputs["stage-display"], timerGraphics: ids.map(defaultLiveTimerGraphic) },
  },
});
