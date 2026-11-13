import { useEffect, useId, useReducer, useRef } from "preact/hooks";
import type { LiveCredit } from "../../shared/schemas/live-session-room";
import {
  LIVE_EMBLEM,
  LIVE_LOWER_THIRD_BRAND,
  LIVE_LOWER_THIRD_DRAWING,
  initialLiveLowerThird,
  liveLowerThirdEmblemBox,
  stepLiveLowerThird,
} from "../../shared/live-lower-third";
import { liveCreditAffiliations } from "../../shared/live-room-credits";
import { AgendaAffiliationRotation } from "../site/AgendaSpeakerAffiliations";
import { LiveEmblemLock, LiveEmblemWheel } from "./LiveEmblem";
import "./LiveLowerThird.css";

/** The animations that span a whole phase, one per phase; the end of one moves the lower third on. */
const PHASE_ANIMATION = "pk-live-lower-third-phase-";
/** Moves on even when no animation ends: a hidden tab, or a monitor tile too small to animate. */
const PHASE_FALLBACK_MS = 2000;

const EMBLEM = liveLowerThirdEmblemBox();
const { nameBarSeat, width, height } = LIVE_LOWER_THIRD_DRAWING;
const { nameBar: NAME_BAR, titleBar: TITLE_BAR, underline: UNDERLINE, nameX } = LIVE_LOWER_THIRD_BRAND;
/** The title bar's top, where the name bar's foot is. */
const TITLE_TOP = 233;

function Bars({ credit, stripe }: { credit: LiveCredit; stripe: string }) {
  return (
    <>
      <path class="pk-live-overlay__name-background" d={NAME_BAR} />
      <path d={UNDERLINE} fill={`url(#${stripe})`} />
      {credit.roleLabel ? (
        <text class="pk-live-overlay__role" x={nameX} y="84" font-size="48">
          {credit.roleLabel}
        </text>
      ) : null}
      <text
        class="pk-live-overlay__name"
        x={nameX}
        y={credit.roleLabel ? "190" : "160"}
        font-size={Math.min(credit.roleLabel ? 82 : 95, 3400 / Math.max(1, [...credit.name].length))}
      >
        {credit.name}
      </text>
    </>
  );
}

/**
 * The lower third: the emblem, with the white name bar coming out of its
 * orange seat and the conference-field title bar under it. It moves only when who is on
 * air changes: the emblem rolls in about its own center and the bars extend
 * from it, the reverse on the way out, and for another speaker the bars
 * retract and return with the new name while the emblem stays. A cut, or
 * reduced motion on a monitor, shows each state at once; the first drawing
 * never plays, so a monitor or the layout editor does not replay it.
 */
export function LiveLowerThird({ credit, animate }: { credit: LiveCredit | null; animate: boolean }) {
  const [state, dispatch] = useReducer(stepLiveLowerThird<LiveCredit>, credit, initialLiveLowerThird<LiveCredit>);
  const mounted = useRef(false);
  const clip = useId();
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    dispatch({ type: "change", credit, animate });
  }, [credit, animate]);
  const moving = state.phase !== "shown" && state.phase !== "idle";
  useEffect(() => {
    if (!moving) return;
    const fallback = setTimeout(() => dispatch({ type: "done" }), PHASE_FALLBACK_MS);
    return () => clearTimeout(fallback);
  }, [moving, state.phase, state.shown?.key]);
  const shown = state.shown;
  // The phase's own animation ending moves the lower third on. Listened for directly, so it does not
  // depend on how the runtime names the animation event handler.
  const graphic = useRef<HTMLDivElement>(null);
  const phase = useRef(state.phase);
  phase.current = state.phase;
  const hasShown = shown !== null;
  useEffect(() => {
    const node = graphic.current;
    if (!node) return;
    const ended = (event: AnimationEvent) => {
      if (event.target === node && event.animationName === `${PHASE_ANIMATION}${phase.current}`)
        dispatch({ type: "done" });
    };
    node.addEventListener("animationend", ended);
    return () => node.removeEventListener("animationend", ended);
  }, [hasShown]);
  return (
    <div class="pk-live-overlay__lower-third" data-showing={shown ? "" : undefined}>
      {shown ? (
        <div class="pk-live-overlay__lower-third-graphic" data-phase={state.phase} ref={graphic}>
          <svg class="pk-live-overlay__lower-third-bars" viewBox={`0 0 ${width} ${height}`} aria-label={shown.name}>
            <defs>
              {/* The conference stripe, from the orange of the seat it leaves through blue to green. */}
              <linearGradient id={`${clip}-stripe`} gradientUnits="userSpaceOnUse" x1="380" x2="2331" y1="0" y2="0">
                <stop offset="0%" class="pk-live-overlay__stripe-orange" />
                <stop offset="50%" class="pk-live-overlay__stripe-blue" />
                <stop offset="100%" class="pk-live-overlay__stripe-green" />
              </linearGradient>
              {/*
               * The name bar is revealed from the seat outward, its curved left end in place from the
               * first frame; the title bar's field shows nothing above the name bar's foot.
               */}
              <clipPath id={`${clip}-name`}>
                <rect
                  class="pk-live-overlay__lower-third-name-reveal"
                  x={nameBarSeat.top.x}
                  y="0"
                  width={width - nameBarSeat.top.x}
                  height={height}
                />
              </clipPath>
              <clipPath id={`${clip}-title`}>
                <rect x="0" y={TITLE_TOP} width={width} height={height - TITLE_TOP} />
              </clipPath>
            </defs>
            <g clip-path={`url(#${clip}-title)`}>
              <g class="pk-live-overlay__lower-third-title-bar">
                {/* The conference field, painted with the kit's own tokens. */}
                <foreignObject {...TITLE_BAR}>
                  <div class="pk-live-overlay__title-field" />
                </foreignObject>
              </g>
            </g>
            <g clip-path={`url(#${clip}-name)`}>
              <Bars credit={shown} stripe={`${clip}-stripe`} />
            </g>
            <g class="pk-live-overlay__lower-third-emblem-roll">
              <svg
                class="pk-live-overlay__lower-third-emblem"
                x={EMBLEM.x}
                y={EMBLEM.y}
                width={EMBLEM.size}
                height={EMBLEM.size}
                viewBox={`0 0 ${LIVE_EMBLEM.box} ${LIVE_EMBLEM.box}`}
                aria-hidden="true"
              >
                {/*
                 * The exact emblem in its square box, centered on the ring, so it spins true. Only the seats
                 * and their spokes turn: the keyhole rolls in upright at the center.
                 */}
                <g class="pk-live-overlay__lower-third-emblem-spin">
                  <LiveEmblemWheel />
                </g>
                <LiveEmblemLock />
              </svg>
            </g>
          </svg>
          <TitleLine credit={shown} />
        </div>
      ) : null}
    </div>
  );
}

/** The title line: the person's identity, or each of several in turn, rolling up to the next on the agenda's timing. */
function TitleLine({ credit }: { credit: LiveCredit }) {
  const lines = liveCreditAffiliations(credit);
  return (
    <div class="pk-live-overlay__title">
      {lines.length > 1 ? (
        <AgendaAffiliationRotation labels={lines}>
          {lines.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </AgendaAffiliationRotation>
      ) : (
        <span>{lines[0] ?? ""}</span>
      )}
    </div>
  );
}
