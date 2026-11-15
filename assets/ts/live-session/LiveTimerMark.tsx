import { LIVE_EMBLEM } from "../../shared/live-lower-third";
import { LiveEmblemWheel } from "./LiveEmblem";
import { useNumericCssProperties } from "../hooks/useNumericCssProperties";
import "./LiveTimerMark.css";

/** The emblem's center, where its open middle holds the time, in the emblem's own square box. */
const CENTER = LIVE_EMBLEM.center.x;
/**
 * The width of the emblem's open middle (159 across) the time may take, in the
 * mark's units: the rest is a margin, so the time never crowds the ring.
 */
const OPEN_WIDTH = 112;
/** The type size that fits the open middle: two digits large, a longer reading as large as it fits. */
const typeSize = (text: string) => Math.min(76, Math.floor(OPEN_WIDTH / ([...text].length * 0.6)));

/**
 * The timer as the mark: the consortium emblem, in white, with the time where
 * its keyhole is, for a short countdown such as a pitch. The emblem is drawn
 * in its own square box centered on its rotation center, so it turns round
 * and never wobbles; the time stays upright in the middle. Its seats turn one step a
 * second, a full turn a minute, like a second hand, and on every second it
 * beats once. It warns in the event's orange, and once over reads the time
 * over with a `+`. A paused timer holds still. It draws at its own size in
 * the mark's units, so whatever box it is set in scales it whole.
 */
export function LiveTimerMark({
  text,
  shownMs,
  tone,
  running,
  label,
}: {
  /** What the center reads (see `formatLiveTimerMark`). */
  text: string;
  /** The time shown, so the seats step with its seconds. */
  shownMs: number;
  tone: "warn" | "over" | undefined;
  running: boolean;
  label?: string | null;
}) {
  const seconds = Math.ceil(shownMs / 1000);
  // One step clockwise for every second that goes by, whichever way the time counts.
  const geometry = useNumericCssProperties({ "--mark-turn": -seconds * 6 });
  return (
    <div
      class="pk-live-timer-mark"
      data-tone={tone}
      data-running={running ? "" : undefined}
      // Two names for the same beat: switching between them each second plays it again.
      data-beat={seconds % 2 === 0 ? "even" : "odd"}
      data-numeric-css-properties={geometry}
    >
      <svg class="pk-live-timer-mark__mark" viewBox={`0 0 ${LIVE_EMBLEM.box} ${LIVE_EMBLEM.box}`} aria-hidden="true">
        <g class="pk-live-timer-mark__wheel">
          <LiveEmblemWheel />
        </g>
        <circle class="pk-live-timer-mark__ripple" cx={CENTER} cy={CENTER} r={LIVE_EMBLEM.seatRadius} />
        <text class="pk-live-timer-mark__time" x={CENTER} y={CENTER + 3} font-size={typeSize(text)}>
          {text}
        </text>
      </svg>
      {label ? <p class="pk-live-timer-mark__label">{label}</p> : null}
    </div>
  );
}
