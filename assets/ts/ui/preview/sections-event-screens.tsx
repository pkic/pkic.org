/**
 * Event screen specimens: each view a venue screen shows, on its 1920 × 1080
 * frame scaled to the gallery column, drawn through the screen's own display
 * code on a fixed clock. Screenshot one full size by opening it alone
 * (`?only=<id>`) in a 1920 × 1080 window.
 */
import type { ComponentChildren } from "preact";
import type { PreviewSection } from "./PreviewShell";
import { ScreenPairing, ScreenWaiting } from "../../event-screens/ScreenStatus";
import { ScreenView } from "../../event-screens/ScreenApp";
import { screenAutoState } from "../../event-screens/screen-auto-mode";
import type { ScreenMarker } from "../../event-screens/screen-display";
import { ScreenLivestream } from "../../event-screens/ScreenLivestream";
import { LiveClockContext } from "../../live-session/useLiveCountdown";
import type { LiveRoomState } from "../../live-session/live-room-state";
import {
  SCREEN_FIXTURE,
  SCREEN_FIXTURE_NOW,
  screenAgendaFixture,
  screenStageReadyFixture,
  screenStageRunningFixture,
} from "./event-screens-fixtures";
import "../../../design/fonts-mono.css";
import "./event-screens-preview.css";

const fixedClock = () => SCREEN_FIXTURE_NOW;

function Screen({ children }: { children: ComponentChildren }) {
  return (
    <LiveClockContext.Provider value={fixedClock}>
      <div class="pk-preview__screen">{children}</div>
    </LiveClockContext.Provider>
  );
}

function StageDisplay({ state, marker }: { state: LiveRoomState; marker: ScreenMarker }) {
  return (
    <Screen>
      <ScreenView
        screenId={SCREEN_FIXTURE.screenId}
        now={SCREEN_FIXTURE_NOW}
        display={{
          kind: "output",
          output: "stage-display",
          layout: null,
          roomId: SCREEN_FIXTURE.roomId,
          state,
          marker,
        }}
      />
    </Screen>
  );
}

const autoState = screenAutoState(
  screenAgendaFixture,
  { id: SCREEN_FIXTURE.roomId, name: SCREEN_FIXTURE.roomName },
  SCREEN_FIXTURE_NOW,
)!;

const display = screenStageRunningFixture.outputs["stage-display"];
const longTitleState: LiveRoomState = {
  ...screenStageRunningFixture,
  outputs: {
    ...screenStageRunningFixture.outputs,
    "stage-display": {
      ...display,
      schedule: display.schedule && {
        ...display.schedule,
        rooms: display.schedule.rooms.map((room) => ({
          ...room,
          title: "Migrating a private CA hierarchy to post-quantum algorithms without breaking relying parties",
        })),
      },
    },
  },
};

export const eventScreenSections: PreviewSection[] = [
  {
    id: "screen-pairing",
    title: "Screen: pairing",
    note: "An unpaired screen, read from across the room by the staff member who pairs it.",
    render: () => (
      <Screen>
        <ScreenPairing
          screenId={SCREEN_FIXTURE.screenId}
          pairing={{ code: SCREEN_FIXTURE.pairingCode, expiresIn: "09:41" }}
        />
      </Screen>
    ),
  },
  {
    id: "screen-waiting",
    title: "Screen: waiting",
    note: "Paired and named, with no assignment yet.",
    render: () => (
      <Screen>
        <ScreenWaiting screenId={SCREEN_FIXTURE.screenId} name={SCREEN_FIXTURE.name} />
      </Screen>
    ),
  },
  {
    id: "screen-stage-display",
    title: "Screen: stage display",
    note: "Connected: the studio is in charge.",
    render: () => <StageDisplay state={screenStageRunningFixture} marker={null} />,
  },
  {
    id: "screen-stage-offline-dot",
    title: "Screen: stage display, just offline",
    note: "Under two minutes without word from the server: the last state, its timers counting, and a dot.",
    render: () => <StageDisplay state={screenStageRunningFixture} marker={{ kind: "offline-dot" }} />,
  },
  {
    id: "screen-stage-offline-badge",
    title: "Screen: stage display, offline for minutes",
    note: "Past two minutes, the badge says how long the screen has heard nothing.",
    render: () => <StageDisplay state={screenStageRunningFixture} marker={{ kind: "offline-badge", minutes: 6 }} />,
  },
  {
    id: "screen-stage-offline-long-title",
    title: "Screen: stage display, offline, long title",
    note: "The badge ends the bottom line; a long Up next title stops short of it.",
    render: () => <StageDisplay state={longTitleState} marker={{ kind: "offline-badge", minutes: 12 }} />,
  },
  {
    id: "screen-stage-auto",
    title: "Screen: auto mode",
    note: "Still offline after the studio's session ended: the screen follows its copy of the room's agenda.",
    render: () => <StageDisplay state={autoState} marker={{ kind: "auto" }} />,
  },
  {
    id: "screen-stage-ready",
    title: "Screen: stage display, ready",
    note: "Between sessions the studio selects what comes next; the stage display is ready for the next speaker.",
    render: () => <StageDisplay state={screenStageReadyFixture} marker={null} />,
  },
  {
    id: "screen-livestream",
    title: "Screen: livestream",
    note: "The room's livestream edge to edge at all times, breaks included; the box stands in for the player.",
    render: () => (
      <Screen>
        <ScreenLivestream>
          <div class="pk-preview__screen-player">Livestream player</div>
        </ScreenLivestream>
      </Screen>
    ),
  },
  {
    id: "screen-livestream-reconnecting",
    title: "Screen: livestream reconnecting",
    note: "Only while the player has failed, stalled or the stream ended; the card covers the player as it retries.",
    render: () => (
      <Screen>
        <ScreenLivestream reconnectingRoom={SCREEN_FIXTURE.roomName}>
          <div class="pk-preview__screen-player">Livestream player</div>
        </ScreenLivestream>
      </Screen>
    ),
  },
];
