/**
 * A browser screen's one control, on every state it shows (pairing code,
 * waiting, any output), fixed in a corner of the window so nothing on the
 * screen moves when it comes or goes: what is missing, and one button that
 * does what the next click can. After a reload that is Resume (sharing this
 * tab again; full screen follows on the next click); otherwise Full screen, Share this tab, Turn
 * on sound once the livestream's player is blocked, or Keep awake when the
 * browser refused the wake lock without a click. The screen runs without
 * the click.
 */
import type { ScreenBrowserState } from "../../shared/schemas/event-screen-monitor";
import { Button } from "../ui/Button";
import { BROWSER_SCREEN_CAPTURE_REFUSALS, type BrowserScreen } from "./browser-screen";
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
  browser: Pick<BrowserScreen, "get" | "problems" | "subscribe" | "request">;
  /** The livestream's sound, as its player confirms it. */
  sound: ScreenBrowserState["sound"];
  /** Asks the player to unmute and play, within the click. */
  onSound?: () => void;
}) {
  const { state, problems } = useBrowserScreenState(browser);
  const next = state
    ? browserScreenNextClick({ ...state, sound }, { offerWakeLock: problems.includes("wake-lock") })
    : null;
  if (!next) return null;
  const refusal = BROWSER_SCREEN_CAPTURE_REFUSALS.find((problem) => problems.includes(problem));
  const hint = refusal ? BROWSER_SCREEN_PROBLEM_LABELS[refusal] : null;
  return (
    <aside class="pk-screen-resume" aria-label="This screen">
      <span class="pk-screen-resume__missing">{hint ?? next.missing.join(" · ")}</span>
      <Button
        variant="primary"
        onClick={() => {
          // Everything starts within the click: the capture or full screen, the wake lock, then sound.
          if (next.asks.fullscreen || next.asks.capture || next.asks.wakeLock)
            void browser.request({ fullscreen: next.asks.fullscreen, capture: next.asks.capture });
          if (next.asks.sound) onSound();
        }}
      >
        {/* After a refused share the click shares again, whatever else is missing. */}
        {BROWSER_SCREEN_ACTION_LABELS[refusal && next.action === "resume" ? "share" : next.action]}
      </Button>
    </aside>
  );
}
