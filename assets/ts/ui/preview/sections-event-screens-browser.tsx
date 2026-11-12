/**
 * A browser set up as a screen: the setup page with its one button, and the
 * one control in a corner of the window, over what the screen shows: Resume
 * after a reload, or the second click a browser needs for full screen and
 * sound. Open one alone (`?only=<id>`) for a full-window screenshot.
 */
import type { PreviewSection } from "./PreviewShell";
import type { BrowserScreenGrants } from "../../event-screens/browser-screen";
import { BrowserScreenEnroll } from "../../event-screens/BrowserScreenEnroll";
import { BrowserScreenResume } from "../../event-screens/BrowserScreenResume";
import { ScreenView } from "../../event-screens/ScreenApp";
import { ScreenLivestream } from "../../event-screens/ScreenLivestream";
import { LiveClockContext } from "../../live-session/useLiveCountdown";
import { SCREEN_FIXTURE, SCREEN_FIXTURE_NOW, screenStageRunningFixture } from "./event-screens-fixtures";
import "./event-screens-preview.css";

const fixedClock = () => SCREEN_FIXTURE_NOW;
const enroll = async () => [];

const screenWith = (grants: BrowserScreenGrants) => ({
  get: () => grants,
  problems: () => [],
  subscribe: () => () => undefined,
  enroll,
  requestFullscreen: async () => true,
});
/** After a reload: still awake, but no full screen or tab capture until a click. */
const reloaded = screenWith({ fullscreen: false, wakeLock: true, capture: "off" });
/** The setup click went to the capture, and the livestream's player was refused sound. */
const secondClick = screenWith({ fullscreen: false, wakeLock: true, capture: "live" });

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
        <BrowserScreenResume browser={reloaded} sound="none" />
      </LiveClockContext.Provider>
    ),
  },
  {
    id: "screen-browser-second-click",
    title: "Browser screen: full screen and sound",
    note: "A browser that spent the setup click on the tab capture, on a livestream its player could not start with sound: one more click in the same corner.",
    render: () => (
      <div class="pk-preview__screen">
        <ScreenLivestream>
          <div class="pk-preview__screen-player">Livestream player</div>
        </ScreenLivestream>
        <BrowserScreenResume browser={secondClick} sound="blocked" onSound={() => undefined} />
      </div>
    ),
  },
];
