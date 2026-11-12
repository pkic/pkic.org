import type { BrowserScreenProblem } from "./browser-screen";

/** What a browser screen says it could not get, in a few words each. */
export const BROWSER_SCREEN_PROBLEM_LABELS: Record<BrowserScreenProblem, string> = {
  fullscreen: "No full screen",
  "wake-lock": "May sleep",
  sound: "No sound",
  capture: "No picture for staff",
  "capture-surface": "No picture for staff: share this tab",
};
