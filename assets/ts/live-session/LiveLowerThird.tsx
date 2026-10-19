import { useEffect, useId, useReducer, useRef } from "preact/hooks";
import type { LiveCredit } from "../../shared/schemas/live-session-room";
import {
  LIVE_LOWER_THIRD_BRAND,
  LIVE_LOWER_THIRD_DRAWING,
  initialLiveLowerThird,
  liveLowerThirdEmblemBox,
  stepLiveLowerThird,
} from "../../shared/live-lower-third";
import { liveCreditAffiliation } from "../../shared/live-room-credits";
import "./LiveLowerThird.css";

/** The animations that span a whole phase, one per phase; the end of one moves the lower third on. */
const PHASE_ANIMATION = "pk-live-lower-third-phase-";
/** Moves on even when no animation ends: a hidden tab, or a monitor tile too small to animate. */
const PHASE_FALLBACK_MS = 2000;

const EMBLEM = liveLowerThirdEmblemBox();
const { nameBarSeat, width, height } = LIVE_LOWER_THIRD_DRAWING;
const { nameBar: NAME_BAR, titleBar: TITLE_BAR, nameX, emblem: BRAND_EMBLEM } = LIVE_LOWER_THIRD_BRAND;
/** The title bar's top, where the name bar's foot is. */
const TITLE_TOP = 233;

function Bars({ credit }: { credit: LiveCredit }) {
  return (
    <>
      <path class="pk-live-overlay__name-background" d={NAME_BAR} />
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
 * orange seat and the grey title bar under it. It moves only when who is on
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
  }, [credit]);
  const moving = state.phase !== "shown" && state.phase !== "idle";
  useEffect(() => {
    if (!moving) return;
    const fallback = setTimeout(() => dispatch({ type: "done" }), PHASE_FALLBACK_MS);
    return () => clearTimeout(fallback);
  }, [state.phase, state.shown?.key]);
  const shown = state.shown;
  // The phase's own animation ending moves the lower third on. Listened for directly, so it does not
  // depend on how the runtime names the animation event handler.
  const graphic = useRef<HTMLDivElement>(null);
  const phase = useRef(state.phase);
  phase.current = state.phase;
  useEffect(() => {
    const node = graphic.current;
    if (!node) return;
    const ended = (event: AnimationEvent) => {
      if (event.target === node && event.animationName === `${PHASE_ANIMATION}${phase.current}`)
        dispatch({ type: "done" });
    };
    node.addEventListener("animationend", ended);
    return () => node.removeEventListener("animationend", ended);
  }, [shown !== null]);
  return (
    <div class="pk-live-overlay__lower-third" data-showing={shown ? "" : undefined}>
      {shown ? (
        <div class="pk-live-overlay__lower-third-graphic" data-phase={state.phase} ref={graphic}>
          <svg class="pk-live-overlay__lower-third-bars" viewBox={`0 0 ${width} ${height}`} aria-label={shown.name}>
            <defs>
              {/*
               * The name bar is revealed from the seat outward, its curved left end in place from the
               * first frame; the title bar shows nothing above the name bar's foot.
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
                <path class="pk-live-overlay__title-background" d={TITLE_BAR} />
              </g>
            </g>
            <g clip-path={`url(#${clip}-name)`}>
              <Bars credit={shown} />
            </g>
            <g class="pk-live-overlay__lower-third-emblem-roll">
              <svg
                class="pk-live-overlay__lower-third-emblem"
                x={EMBLEM.x}
                y={EMBLEM.y}
                width={EMBLEM.size}
                height={EMBLEM.size}
                viewBox={`${EMBLEM.x} ${EMBLEM.y} ${EMBLEM.size} ${EMBLEM.size}`}
                aria-hidden="true"
              >
                {/* The brand emblem in the drawing's coordinates; its box is centered on the emblem, so it spins true. */}
                <g class="pk-live-overlay__lower-third-emblem-spin">
                  <path class="pk-live-overlay__emblem-blue" d={BRAND_EMBLEM.blue} />
                  <path class="pk-live-overlay__emblem-orange" d={BRAND_EMBLEM.orange} />
                  <path class="pk-live-overlay__emblem-green" d={BRAND_EMBLEM.green} />
                  <path class="pk-live-overlay__emblem-ink" fill-rule="evenodd" d={BRAND_EMBLEM.table} />
                  <path class="pk-live-overlay__emblem-ink" d={BRAND_EMBLEM.keyhole} />
                </g>
              </svg>
            </g>
          </svg>
          <div class="pk-live-overlay__title">
            <span>{liveCreditAffiliation(shown)}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
