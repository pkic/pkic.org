/**
 * A browser opening the screen page without a screen ID: one button sets it
 * up as a screen. The click asks for everything at once; the browser then
 * takes its own screen ID and goes on to pairing, whatever it was refused.
 */
import { useState } from "preact/hooks";
import { Button } from "../ui/Button";
import type { BrowserScreen } from "./browser-screen";
import { ScreenStatusFrame } from "./ScreenStatus";
import "./ScreenEnroll.css";

export function BrowserScreenEnroll({
  browser,
  onEnrolled,
}: {
  browser: Pick<BrowserScreen, "enroll">;
  /** After the click's requests settle, granted or not. */
  onEnrolled: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <ScreenStatusFrame view="screen-enroll">
      <div class="pk-screen-enroll">
        <h1 class="pk-screen-enroll__title">Set up this browser as a screen</h1>
        <p class="pk-screen-status__muted">
          Full screen, kept awake, with the livestream's sound. Share this tab when asked, so staff see what it shows.
          Then pair it in the event workspace like any screen.
        </p>
        <p>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void browser.enroll().finally(onEnrolled);
            }}
          >
            Enroll
          </Button>
        </p>
      </div>
      <p class="pk-screen-status__line pk-screen-status__muted">
        <span>This browser keeps its screen ID</span>
      </p>
    </ScreenStatusFrame>
  );
}
