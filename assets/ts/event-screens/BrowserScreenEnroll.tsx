/**
 * A browser opening the screen page without a screen ID: one button sets it
 * up as a screen. The click shares the screen (full screen follows on the
 * next click anywhere); the browser then
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
          Share the whole screen when asked, so staff see exactly what it shows, then click anywhere for full screen. It
          stays awake, with the livestream's sound. Then pair it in the event workspace like any screen. Use a laptop
          for this screen only: staff see everything on it.
        </p>
        <p class="pk-screen-status__muted">
          To stay full screen after a reload, use the browser's own full screen: F11, or Control-Command-F on a Mac.
        </p>
        <p>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void browser
                .enroll()
                .catch(() => [])
                .then(() => {
                  // Whatever was refused, the screen goes on; if going on fails, the button is ready again.
                  try {
                    onEnrolled();
                  } catch {
                    /* Nothing more to do here; another click tries again. */
                  } finally {
                    setBusy(false);
                  }
                });
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
