import type { ScreenBrowserState } from "../../shared/schemas/event-screen-monitor";
import type { BrowserScreenProblem } from "./browser-screen";

/** What a browser screen says it could not get, in a few words each. */
export const BROWSER_SCREEN_PROBLEM_LABELS: Record<BrowserScreenProblem, string> = {
  fullscreen: "No full screen",
  "wake-lock": "May sleep",
  capture: "No picture for staff",
  "capture-surface": "No picture for staff: share this tab",
};

export type BrowserScreenAction = "resume" | "fullscreen" | "sound" | "fullscreen-sound";

export const BROWSER_SCREEN_ACTION_LABELS: Record<BrowserScreenAction, string> = {
  resume: "Resume",
  fullscreen: "Full screen",
  sound: "Turn on sound",
  "fullscreen-sound": "Full screen and sound",
};

/**
 * What a browser screen is missing, and what its next click can do about
 * it: the tab capture needs the whole setup again (Resume); otherwise full
 * screen, sound or both. Null when nothing a click can bring back is missing.
 */
export function browserScreenNextClick(
  state: ScreenBrowserState,
): { missing: string[]; action: BrowserScreenAction } | null {
  const missing = [
    !state.fullscreen ? "No full screen" : null,
    state.sound === "blocked" ? "No sound" : null,
    state.capture === "stopped" ? "Sharing stopped" : state.capture === "off" ? "No picture for staff" : null,
  ].filter((each): each is string => each !== null);
  const sound = state.sound === "blocked";
  const action: BrowserScreenAction | null =
    state.capture !== "live"
      ? "resume"
      : !state.fullscreen && sound
        ? "fullscreen-sound"
        : !state.fullscreen
          ? "fullscreen"
          : sound
            ? "sound"
            : null;
  return action ? { missing, action } : null;
}
