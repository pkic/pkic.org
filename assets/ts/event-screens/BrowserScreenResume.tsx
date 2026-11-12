/**
 * After a reload a browser screen has lost full screen, sound and its tab
 * capture until someone clicks again. One small button in a fixed corner
 * brings them back; it moves nothing on the screen, and the screen runs
 * without it.
 */
import { Button } from "../ui/Button";
import { screenBrowserNeedsResume } from "../../shared/event-screen-health";
import type { BrowserScreen } from "./browser-screen";
import { BROWSER_SCREEN_PROBLEM_LABELS } from "./browser-screen-copy";
import { useBrowserScreenState } from "./useBrowserScreenState";
import "./BrowserScreen.css";

export function BrowserScreenResume({
  browser,
}: {
  browser: Pick<BrowserScreen, "get" | "problems" | "subscribe" | "enroll">;
}) {
  const { state, problems } = useBrowserScreenState(browser);
  if (!state || !screenBrowserNeedsResume(state)) return null;
  const missing = [
    !state.fullscreen ? "No full screen" : null,
    !state.sound ? "No sound" : null,
    state.capture === "stopped" ? "Sharing stopped" : state.capture === "off" ? "No picture for staff" : null,
  ].filter(Boolean);
  const hint = problems.includes("capture-surface") ? BROWSER_SCREEN_PROBLEM_LABELS["capture-surface"] : null;
  return (
    <aside class="pk-screen-resume" aria-label="This screen">
      <span class="pk-screen-resume__missing">{hint ?? missing.join(" · ")}</span>
      <Button variant="primary" onClick={() => void browser.enroll()}>
        Resume
      </Button>
    </aside>
  );
}
