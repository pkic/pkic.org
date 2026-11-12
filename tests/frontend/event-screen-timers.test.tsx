// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { constants } from "../../assets/design/tokens";
import type { ScreenMarker } from "../../assets/ts/event-screens/screen-display";
import { screenAutoState } from "../../assets/ts/event-screens/screen-auto-mode";
import { ScreenView } from "../../assets/ts/event-screens/ScreenApp";
import type { LiveRoomState } from "../../assets/ts/live-session/live-room-state";
import { LiveClockContext } from "../../assets/ts/live-session/useLiveCountdown";
import {
  SCREEN_FIXTURE,
  SCREEN_FIXTURE_NOW,
  screenAgendaFixture,
  screenStageRunningFixture,
} from "../../assets/ts/ui/preview/event-screens-fixtures";

let host: HTMLElement | undefined;
afterEach(async () => {
  if (host) await act(() => render(null, host!));
  host?.remove();
  host = undefined;
});

const withTimer = (state: LiveRoomState, heldMs: number): LiveRoomState => ({
  ...state,
  timers: state.timers.map((timer) => ({ ...timer, heldMs })),
});
const room = { id: SCREEN_FIXTURE.roomId, name: SCREEN_FIXTURE.roomName };
const at = (iso: string) => Date.parse(iso);
const states: Record<string, [LiveRoomState, number]> = {
  running: [screenStageRunningFixture, SCREEN_FIXTURE_NOW],
  overtime: [withTimer(screenStageRunningFixture, -95_000), SCREEN_FIXTURE_NOW],
  "starts in": [screenAutoState(screenAgendaFixture, room, SCREEN_FIXTURE_NOW)!, SCREEN_FIXTURE_NOW],
  "auto session": [
    screenAutoState(screenAgendaFixture, room, at("2026-12-01T09:40:00.000Z"))!,
    at("2026-12-01T09:40:00.000Z"),
  ],
};

async function drawn(state: LiveRoomState, now: number, marker: ScreenMarker) {
  host ??= document.body.appendChild(document.createElement("div"));
  await act(() =>
    render(
      <LiveClockContext.Provider value={() => now}>
        <ScreenView
          screenId={SCREEN_FIXTURE.screenId}
          now={now}
          display={{ kind: "output", output: "stage-display", layout: null, roomId: room.id, state, marker }}
        />
      </LiveClockContext.Provider>,
      host!,
    ),
  );
  return host!;
}

it("draws every timer state in the same countdown face", async () => {
  const classes = new Set<string>();
  for (const [name, [state, now]] of Object.entries(states)) {
    const countdown = (await drawn(state, now, null)).querySelector(".pk-live-stage-display__countdown");
    expect(countdown, name).not.toBeNull();
    classes.add(countdown!.className);
  }
  expect([...classes]).toEqual(["pk-live-stage-display__countdown"]);
  // The countdown's face is the design system's monospace, and no tone or state rule swaps it.
  const css = readFileSync(resolve(process.cwd(), "assets/ts/live-session/LiveStageDisplay.css"), "utf8");
  const fontRules = [...css.matchAll(/([^{}]+)\{[^}]*font-family:\s*([^;]+);/g)].filter(([, selector]) =>
    selector!.includes("countdown"),
  );
  expect(fontRules.map(([, , family]) => family!.trim())).toEqual(["var(--pk-font-mono)"]);
  // That face ships with the outputs, so no device falls back to its own monospace.
  const family = constants["font-mono"].split(",")[0]!.trim();
  const faces = readFileSync(resolve(process.cwd(), "assets/design/fonts-mono.css"), "utf8");
  expect(faces).toContain(`font-family: ${family};`);
});

it("puts the screen's status at the end of the stage display's footer, beside a long title cut at a word", async () => {
  const long = {
    ...screenStageRunningFixture,
    session: { ...screenStageRunningFixture.session, title: "A very long session title ".repeat(8).trim() },
  };
  const page = await drawn(long, SCREEN_FIXTURE_NOW, { kind: "offline-badge", minutes: 6 });
  const footer = page.querySelector(".pk-live-stage-display__footer")!;
  const title = footer.querySelector(".pk-live-stage-display__title")!.textContent!;
  expect(title).toMatch(/^LiveA very long session title( [a-z]+)+…$/iu);
  expect(footer.querySelector(".pk-live-stage-display__aside")?.textContent).toBe("Offline · 6 min");
  expect(page.querySelector(".pk-screen-marker--corner")).toBeNull();
});
