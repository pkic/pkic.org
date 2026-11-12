import type { ScreenBrowserState } from "../../shared/schemas/event-screen-monitor";
import type { BrowserScreenProblem } from "./browser-screen";

/** What a browser screen says it could not get, in a few words each. */
export const BROWSER_SCREEN_PROBLEM_LABELS: Record<BrowserScreenProblem, string> = {
  fullscreen: "No full screen",
  "wake-lock": "May sleep",
  capture: "Tab not shared",
  "capture-surface": "Share this tab, not a window or screen",
  "capture-other-tab": "Wrong tab shared",
  "capture-unverified": "Tab can't be verified",
};

export type BrowserScreenAction = "resume" | "fullscreen" | "share" | "sound" | "awake";

export const BROWSER_SCREEN_ACTION_LABELS: Record<BrowserScreenAction, string> = {
  resume: "Resume",
  fullscreen: "Full screen",
  share: "Share this tab",
  sound: "Turn on sound",
  awake: "Keep awake",
};

/**
 * What a browser screen is missing, and what its next click does about it,
 * first of full screen, then sharing this tab, then sound; one click takes
 * whatever of them it can, so two clicks are the most it takes. Missing both
 * full screen and sharing, as after a reload, the click is Resume. Kept
 * awake needs no click; every click asks for it again, and only a browser
 * that refused it without one (`offerWakeLock`) gets a click for it alone.
 * Null when nothing a click can bring back is missing.
 */
export function browserScreenNextClick(
  state: ScreenBrowserState,
  { offerWakeLock = false }: { offerWakeLock?: boolean } = {},
): {
  missing: string[];
  action: BrowserScreenAction;
  /** What the click asks for, in order. */
  asks: { fullscreen: boolean; capture: boolean; sound: boolean; wakeLock: boolean };
} | null {
  const missing = [
    !state.fullscreen ? "No full screen" : null,
    state.capture === "stopped" ? "Sharing stopped" : state.capture === "off" ? "Tab not shared" : null,
    state.sound === "blocked" ? "No sound" : null,
    !state.wakeLock ? BROWSER_SCREEN_PROBLEM_LABELS["wake-lock"] : null,
  ].filter((each): each is string => each !== null);
  const asks = {
    fullscreen: !state.fullscreen,
    capture: state.capture !== "live",
    sound: state.sound === "blocked",
    wakeLock: !state.wakeLock && offerWakeLock,
  };
  const action: BrowserScreenAction | null =
    asks.fullscreen && asks.capture
      ? "resume"
      : asks.fullscreen
        ? "fullscreen"
        : asks.capture
          ? "share"
          : asks.sound
            ? "sound"
            : asks.wakeLock
              ? "awake"
              : null;
  return action ? { missing, action, asks } : null;
}
