/**
 * A browser set up as a screen: the setup page with its one button, and the
 * Resume button a reload leaves in a corner of the window, over what the
 * screen shows. Open one alone (`?only=<id>`) for a full-window screenshot.
 */
import type { PreviewSection } from "./PreviewShell";
import type { ScreenBrowserState } from "../../../shared/schemas/event-screen-monitor";
import { BrowserScreenEnroll } from "../../event-screens/BrowserScreenEnroll";
import { BrowserScreenResume } from "../../event-screens/BrowserScreenResume";
import { ScreenView } from "../../event-screens/ScreenApp";
import { LiveClockContext } from "../../live-session/useLiveCountdown";
import { SCREEN_FIXTURE, SCREEN_FIXTURE_NOW, screenStageRunningFixture } from "./event-screens-fixtures";
import "./event-screens-preview.css";

const fixedClock = () => SCREEN_FIXTURE_NOW;
const enroll = async () => [];

/** After a reload: still awake, but no full screen, sound or tab capture until a click. */
const reloaded: ScreenBrowserState = { fullscreen: false, wakeLock: true, sound: false, capture: "off" };
const reloadedScreen = { get: () => reloaded, problems: () => [], subscribe: () => () => undefined, enroll };

export const eventScreenBrowserSections: PreviewSection[] = [
  {
    id: "screen-browser-enroll",
    title: "Browser screen: setup",
    note: "A browser opening the screen page without a screen ID. One click asks for full screen, a wake lock, sound and this tab's picture, then pairing follows.",
    render: () => (
      <div class="pk-preview__screen">
        <BrowserScreenEnroll browser={{ enroll }} onEnrolled={() => undefined} />
      </div>
    ),
  },
  {
    id: "screen-browser-resume",
    title: "Browser screen: Resume after a reload",
    note: "Fixed in the window's corner, so the timer, messages and video never move; the screen runs without the click.",
    render: () => (
      <LiveClockContext.Provider value={fixedClock}>
        <div class="pk-preview__screen">
          <ScreenView
            screenId={SCREEN_FIXTURE.screenId}
            now={SCREEN_FIXTURE_NOW}
            display={{
              kind: "output",
              output: "stage-display",
              layout: null,
              roomId: SCREEN_FIXTURE.roomId,
              state: screenStageRunningFixture,
              marker: null,
            }}
          />
        </div>
        <BrowserScreenResume browser={reloadedScreen} />
      </LiveClockContext.Provider>
    ),
  },
];
