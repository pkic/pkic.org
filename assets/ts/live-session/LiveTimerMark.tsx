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
/**
 * The time sits on its baseline, half its digits' height below the center, so
 * the digits' ink is centered whatever the font's box: a mono digit is 0.6 of
 * the type size tall.
 */
const DIGIT_HALF_HEIGHT = 0.3;
/** The tight letter spacing leaves its last gap trailing; the time moves back half of it. */
const TRAILING_SPACE_HALF = 0.02;
/** How far out from the center the glare rides on the seats, in the mark's units. */
const GLARE_RADIUS = 136;
/**
 * The circle whose stroke reveals the fill: its stroke runs from the center
 * to past the seats' tips, so a dash of it is the wedge the time has gone.
 * Its length is in the stylesheet's dash.
 */
const REVEAL_RADIUS = 92;

type Point = { x: number; y: number };
/** A point at `turn` clockwise from the top, `radius` out from the center. */
function polar(turn: number, radius: number): Point {
  const angle = turn * 2 * Math.PI;
  return { x: CENTER + radius * Math.sin(angle), y: CENTER - radius * Math.cos(angle) };
}
const turnOf = ({ x, y }: Point) => (Math.atan2(x - CENTER, CENTER - y) / (2 * Math.PI) + 1) % 1;
const round = (value: number) => Math.round(value * 100) / 100;

/**
 * The fill's colors, laid on each seat: green at the top, blue half way
 * round and orange back at the top, as a sweep would set them. Each seat
 * gets a straight gradient along its own chord, placed so the colors land
 * where the sweep has them across the seat. The emblem is three of the same
 * seat a third of a turn apart, so the orange seat's ends place all three.
 */
const SEAT_SWEEPS = [0, 1 / 3, 2 / 3].map((spoke) => {
  const start = turnOf(LIVE_EMBLEM.orangeSeat.top) + spoke;
  const end = turnOf(LIVE_EMBLEM.orangeSeat.bottom) + spoke;
  const from = polar(start, LIVE_EMBLEM.seatRadius);
  const to = polar(end, LIVE_EMBLEM.seatRadius);
  const along = (turn: number) => {
    const share = (turn - start) / (end - start);
    return { x: round(from.x + share * (to.x - from.x)), y: round(from.y + share * (to.y - from.y)) };
  };
  // The third of the circle between two spokes, reaching well past the seat's tips.
  const sector = [polar(spoke, 0), polar(spoke, 260), polar(spoke + 1 / 6, 260), polar(spoke + 1 / 3, 260)]
    .map(({ x, y }) => `${round(x)},${round(y)}`)
    .join(" ");
  return { sector, zero: along(0), whole: along(1) };
});

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
 * between them blinks while the time over reads with a `+`. A paused
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
  const reveal = `${id}-reveal`;
  const size = typeSize(text);
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
          <mask
            id={reveal}
            class="pk-live-timer-mark__reveal-mask"
            maskUnits="userSpaceOnUse"
            x="0"
            y="0"
            width={LIVE_EMBLEM.box}
            height={LIVE_EMBLEM.box}
          >
            <circle class="pk-live-timer-mark__reveal" cx={CENTER} cy={CENTER} r={REVEAL_RADIUS} />
          </mask>
          {SEAT_SWEEPS.map((seat, index) => (
            <linearGradient
              key={index}
              id={`${id}-sweep-${index}`}
              gradientUnits="userSpaceOnUse"
              x1={seat.zero.x}
              y1={seat.zero.y}
              x2={seat.whole.x}
              y2={seat.whole.y}
            >
              <stop class="pk-live-timer-mark__stop-green" offset="0" />
              <stop class="pk-live-timer-mark__stop-blue" offset="0.5" />
              <stop class="pk-live-timer-mark__stop-orange" offset="1" />
            </linearGradient>
          ))}
        </defs>
        <g class="pk-live-timer-mark__track">
          <LiveEmblemSeats />
        </g>
        <g filter={`url(#${glow})`}>
          <g clip-path={`url(#${seats})`}>
            <MarkSweep id={id} reveal={reveal} />
          </g>
        </g>
        <g clip-path={`url(#${seats})`}>
          <MarkSweep id={id} reveal={reveal} />
          <g class="pk-live-timer-mark__glare">
            <circle cx={CENTER} cy={CENTER - GLARE_RADIUS} r="16" filter={`url(#${glare})`} />
          </g>
        </g>
        <LiveEmblemRing />
        <circle class="pk-live-timer-mark__ripple" cx={CENTER} cy={CENTER} r={LIVE_EMBLEM.seatRadius} />
        <text
          class="pk-live-timer-mark__time"
          x={CENTER - size * TRAILING_SPACE_HALF}
          y={CENTER + size * DIGIT_HALF_HEIGHT}
          font-size={size}
        >
          {text}
        </text>
      </svg>
      {label ? <p class="pk-live-timer-mark__label">{label}</p> : null}
    </div>
  );
}

/**
 * The seats' fill: the event's colors swept round from the top, shown as far
 * as the time has gone. It is drawn in the SVG itself, not as HTML inside it:
 * WebKit draws HTML in an SVG at its own size and outside the clip.
 */
function MarkSweep({ id, reveal }: { id: string; reveal: string }) {
  return (
    <g mask={`url(#${reveal})`}>
      {SEAT_SWEEPS.map((seat, index) => (
        <polygon key={index} points={seat.sector} fill={`url(#${id}-sweep-${index})`} />
      ))}
    </g>
  );
}
