import { LIVE_EMBLEM } from "../../shared/live-lower-third";
import { useId, useRef } from "preact/hooks";
import { LiveEmblemRing, LiveEmblemSeats } from "./LiveEmblem";
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
/** How far out from the center the glare rides on the seats, in the mark's units. */
const GLARE_RADIUS = 136;

/**
 * How full the seats are: the share of a countdown's length gone, or for a
 * timer with no length, such as a stopwatch, the seconds of the minute.
 */
function fillFraction(spent: number | null, shownMs: number, tone: "warn" | "over" | undefined) {
  if (tone === "over") return 1;
  if (spent !== null) return spent;
  return (Math.floor(shownMs / 1000) % 60) / 60;
}

/**
 * The timer as the mark: the consortium emblem, in white, with the time where
 * its keyhole is, for a short countdown such as a pitch. The emblem is drawn
 * in its own square box, the time upright in the middle. Its seats fill
 * clockwise from the top as the time goes, in the event's colors from green
 * to orange, with a soft glow and a glare riding the leading edge, and on
 * every second it beats once. Once over the seats are full and the ring
 * between them blinks red while the time over reads with a `+`. A paused
 * timer holds still. It draws at its own size in the mark's units, so
 * whatever box it is set in scales it whole.
 */
export function LiveTimerMark({
  text,
  shownMs,
  spent,
  tone,
  running,
  label,
}: {
  /** What the center reads (see `formatLiveTimerMark`). */
  text: string;
  /** The time shown, so the mark beats with its seconds. */
  shownMs: number;
  /** How much of the timer's length has gone, 0 to 1; null for a timer with no length. */
  spent: number | null;
  tone: "warn" | "over" | undefined;
  running: boolean;
  label?: string | null;
}) {
  const seconds = Math.ceil(shownMs / 1000);
  const fill = fillFraction(spent, shownMs, tone);
  // The fill eases on between seconds; when it goes back, on a reset or a new minute, it jumps.
  const previous = useRef(fill);
  const back = fill < previous.current;
  previous.current = fill;
  const geometry = useNumericCssProperties({ "--mark-fill": fill });
  const id = useId();
  const seats = `${id}-seats`;
  const glow = `${id}-glow`;
  const glare = `${id}-glare`;
  return (
    <div
      class="pk-live-timer-mark"
      data-tone={tone}
      data-running={running ? "" : undefined}
      data-fill-back={back ? "" : undefined}
      // Two names for the same beat: switching between them each second plays it again.
      data-beat={seconds % 2 === 0 ? "even" : "odd"}
      data-numeric-css-properties={geometry}
    >
      <svg class="pk-live-timer-mark__mark" viewBox={`0 0 ${LIVE_EMBLEM.box} ${LIVE_EMBLEM.box}`} aria-hidden="true">
        <defs>
          <clipPath id={seats}>
            <LiveEmblemSeats />
          </clipPath>
          <filter id={glow} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="7" />
            <feComponentTransfer>
              <feFuncA type="linear" slope="1.6" />
            </feComponentTransfer>
          </filter>
          <filter id={glare} x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="8" />
          </filter>
        </defs>
        <g class="pk-live-timer-mark__track">
          <LiveEmblemSeats />
        </g>
        <g filter={`url(#${glow})`}>
          <g clip-path={`url(#${seats})`}>
            <MarkSweep />
          </g>
        </g>
        <g clip-path={`url(#${seats})`}>
          <MarkSweep />
          <g class="pk-live-timer-mark__glare">
            <circle cx={CENTER} cy={CENTER - GLARE_RADIUS} r="16" filter={`url(#${glare})`} />
          </g>
        </g>
        <LiveEmblemRing />
        <circle class="pk-live-timer-mark__ripple" cx={CENTER} cy={CENTER} r={LIVE_EMBLEM.seatRadius} />
        <text class="pk-live-timer-mark__time" x={CENTER} y={CENTER + 3} font-size={typeSize(text)}>
          {text}
        </text>
      </svg>
      {label ? <p class="pk-live-timer-mark__label">{label}</p> : null}
    </div>
  );
}

/** The seats' fill: the event's colors swept round from the top, shown as far as the time has gone. */
function MarkSweep() {
  return (
    <foreignObject width={LIVE_EMBLEM.box} height={LIVE_EMBLEM.box}>
      <div class="pk-live-timer-mark__sweep" />
    </foreignObject>
  );
}
