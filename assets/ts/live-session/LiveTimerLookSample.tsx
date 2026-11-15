import type { LiveTimerGraphic } from "../../shared/schemas/live-session-timer";
import { LiveTimerMark } from "./LiveTimerMark";
import { LiveTimerPlate } from "./LiveTimerPlate";
import "./LiveOverlay.css";
import "./LiveTimerLookSample.css";

/** How far a tab runs past its plate on the default layout: the timer box sits 48 px below the frame's top. */
const SAMPLE_TAB_REACH = 48;

/**
 * A timer look as it shows on air, for picking one: the top right of a
 * 1920 x 1080 frame, drawn by the same graphics the outputs use, with the
 * timer where the default layout puts it.
 */
export function LiveTimerLookSample({ look, label }: { look: LiveTimerGraphic["presentation"]; label: string | null }) {
  return (
    <span class="pk-live-timer-look">
      <span class="pk-live-timer-look__frame" data-look={look}>
        {look === "ring" ? (
          <LiveTimerMark text="42" shownMs={42_000} spent={0.55} tone={undefined} running label={label} />
        ) : (
          <LiveTimerPlate
            label={label}
            text="14:32"
            tone={undefined}
            running
            look={look === "digital" ? "plate" : look}
            reach={look === "tab" ? SAMPLE_TAB_REACH : 0}
          />
        )}
      </span>
    </span>
  );
}
