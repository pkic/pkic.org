/**
 * Event screen specimens: each view a venue screen shows, on its 1920 × 1080
 * frame scaled to the gallery column. Screenshot one full size by opening
 * it alone (`?only=<id>`) in a 1920 × 1080 window.
 */
import type { PreviewSection } from "./PreviewShell";
import { ScreenPairing, ScreenWaiting } from "../../event-screens/ScreenStatus";
import { ScreenOfflineDot } from "../../event-screens/ScreenOfflineDot";
import { ScreenLivestream, ScreenLivestreamReconnecting } from "../../event-screens/ScreenLivestream";
import { LiveOverlayPresentation } from "../../live-session/LiveOverlayPresentation";
import { SCREEN_FIXTURE, screenStageReadyFixture, screenStageRunningFixture } from "./event-screens-fixtures";
import "./event-screens-preview.css";

export const eventScreenSections: PreviewSection[] = [
  {
    id: "screen-pairing",
    title: "Screen: pairing",
    note: "An unpaired screen, read from across the room by the staff member who pairs it.",
    render: () => (
      <div class="pk-preview__screen">
        <ScreenPairing
          screenId={SCREEN_FIXTURE.screenId}
          pairing={{ code: SCREEN_FIXTURE.pairingCode, expiresIn: "9:41" }}
        />
      </div>
    ),
  },
  {
    id: "screen-waiting",
    title: "Screen: waiting",
    note: "Paired and named, with no assignment yet.",
    render: () => (
      <div class="pk-preview__screen">
        <ScreenWaiting screenId={SCREEN_FIXTURE.screenId} name={SCREEN_FIXTURE.name} />
      </div>
    ),
  },
  {
    id: "screen-stage-display",
    title: "Screen: stage display, offline",
    note: "Connection lost: the screen keeps the last state with its timers counting, and the dot says it is offline.",
    render: () => (
      <div class="pk-preview__screen">
        <LiveOverlayPresentation
          view="stage-display"
          projection={screenStageRunningFixture}
          roomId={SCREEN_FIXTURE.roomId}
        >
          <ScreenOfflineDot />
        </LiveOverlayPresentation>
      </div>
    ),
  },
  {
    id: "screen-stage-ready",
    title: "Screen: stage display, ready",
    note: "Between sessions the studio selects what comes next; the stage display is ready for the next speaker.",
    render: () => (
      <div class="pk-preview__screen">
        <LiveOverlayPresentation
          view="stage-display"
          projection={screenStageReadyFixture}
          roomId={SCREEN_FIXTURE.roomId}
        />
      </div>
    ),
  },
  {
    id: "screen-livestream",
    title: "Screen: livestream",
    note: "The room's livestream edge to edge at all times, breaks included; the box stands in for the player.",
    render: () => (
      <div class="pk-preview__screen">
        <ScreenLivestream>
          <div class="pk-preview__screen-player">Livestream player</div>
        </ScreenLivestream>
      </div>
    ),
  },
  {
    id: "screen-livestream-reconnecting",
    title: "Screen: livestream reconnecting",
    note: "Only while the player has failed or the stream ended; the screen keeps retrying.",
    render: () => (
      <div class="pk-preview__screen">
        <ScreenLivestreamReconnecting roomName={SCREEN_FIXTURE.roomName} />
      </div>
    ),
  },
];
