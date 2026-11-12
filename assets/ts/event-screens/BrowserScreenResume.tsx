/**
 * A browser screen's one control, fixed in a corner of the window so nothing
 * on the screen moves when it comes or goes: what is missing, and one button
 * that does what the next click can. After a reload that is Resume (the tab
 * capture and full screen again); after a setup click the browser spent on
 * the capture, Full screen; once the livestream's player is blocked from
 * playing with sound, Turn on sound; or full screen and sound together. The
 * screen runs without the click.
 */
import type { ScreenBrowserState } from "../../shared/schemas/event-screen-monitor";
import { Button } from "../ui/Button";
import type { BrowserScreen } from "./browser-screen";
import {
  BROWSER_SCREEN_ACTION_LABELS,
  BROWSER_SCREEN_PROBLEM_LABELS,
  browserScreenNextClick,
} from "./browser-screen-copy";
import { requestLivestreamSound } from "./livestream-player-report";
import { useBrowserScreenState } from "./useBrowserScreenState";
import "./BrowserScreen.css";

export function BrowserScreenResume({
  browser,
  sound,
  onSound = requestLivestreamSound,
}: {
  browser: Pick<BrowserScreen, "get" | "problems" | "subscribe" | "enroll" | "requestFullscreen">;
  /** The livestream's sound, as its player confirms it. */
  sound: ScreenBrowserState["sound"];
  /** Asks the player to unmute and play, within the click. */
  onSound?: () => void;
}) {
  const { state, problems } = useBrowserScreenState(browser);
  const next = state ? browserScreenNextClick({ ...state, sound }) : null;
  if (!next) return null;
  const hint = problems.includes("capture-surface") ? BROWSER_SCREEN_PROBLEM_LABELS["capture-surface"] : null;
  return (
    <aside class="pk-screen-resume" aria-label="This screen">
      <span class="pk-screen-resume__missing">{hint ?? next.missing.join(" · ")}</span>
      <Button
        variant="primary"
        onClick={() => {
          // Everything starts within the click: the capture first, then full screen, then sound.
          if (next.action === "resume") void browser.enroll();
          else if (next.action !== "sound") void browser.requestFullscreen();
          if (sound === "blocked") onSound();
        }}
      >
        {BROWSER_SCREEN_ACTION_LABELS[next.action]}
      </Button>
    </aside>
  );
}
