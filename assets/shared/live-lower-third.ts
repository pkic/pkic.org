/**
 * The lower third: the consortium emblem with the white name bar coming out
 * of its orange seat and the conference-field title bar under it, and how it moves on and
 * off air. Pure, so the overlay, its tests and the control room agree.
 */

/** The emblem as drawn in its own square box: three seats and spokes around one center. */
export const LIVE_EMBLEM = {
  box: 360,
  center: { x: 180, y: 180 },
  /** The seats' outer radius. */
  seatRadius: 146.09,
  /**
   * The orange seat's outer arc, end to end: where it meets the top spoke,
   * and its lower end, which the name bar's left edge runs to.
   */
  orangeSeat: { top: { x: 219.754, y: 39.423 }, bottom: { x: 321.62, y: 215.86 } },
} as const;

/**
 * The lower third's drawing (2500 × 417 units, from the original stream
 * overlay): the slot the emblem sits in, by its center and seat radius, and
 * the name bar's corners on the orange seat.
 */
export const LIVE_LOWER_THIRD_DRAWING = {
  width: 2500,
  height: 417,
  emblem: { center: { x: 201.84, y: 188.05 }, seatRadius: 187.916 },
  nameBarSeat: { top: { x: 252, y: 6 }, bottom: { x: 381.5, y: 234 } },
} as const;

type Point = { x: number; y: number };

/**
 * Where the emblem's square box goes in the drawing: scaled so its seat
 * radius is the slot's, and moved so its center is the slot's center. The
 * name bar then leaves the orange seat exactly where it was drawn to.
 */
export function liveLowerThirdEmblemBox(): { x: number; y: number; size: number; scale: number } {
  const { emblem } = LIVE_LOWER_THIRD_DRAWING;
  const scale = emblem.seatRadius / LIVE_EMBLEM.seatRadius;
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return {
    scale,
    size: round(LIVE_EMBLEM.box * scale),
    x: round(emblem.center.x - LIVE_EMBLEM.center.x * scale),
    y: round(emblem.center.y - LIVE_EMBLEM.center.y * scale),
  };
}

/** A point of the emblem's own box, in the drawing's units, once the emblem is placed. */
export function liveLowerThirdEmblemPoint(point: Point): Point {
  const box = liveLowerThirdEmblemBox();
  return { x: box.x + point.x * box.scale, y: box.y + point.y * box.scale };
}

/**
 * The lower third in the brand's 2500 x 417 drawing: the white name bar,
 * whose left edge runs under the orange seat, the wider title bar set
 * off to the right of the name. The emblem (`LIVE_EMBLEM`, placed by
 * `liveLowerThirdEmblemBox`) is drawn over the bars, so its orange seat is
 * the edge the name bar comes out of.
 */
export const LIVE_LOWER_THIRD_BRAND = {
  nameBar: "m2331 6v228h-1949.5l-19.9-138.3-109.6-89.7z",
  /** The title bar, under the name bar's foot and set off to the right of the name. */
  titleBar: { x: 555, y: 233, width: 1929, height: 184 },
  /**
   * The conference stripe along the name bar's foot, to the bar's end. Its left end is the bar's own
   * slanted edge under the orange seat, so no part of it shows outside the bar.
   */
  underline: "M379.49 220H2331V234H381.5Z",
  /** The name's left margin, and the title's, which starts further right like its bar. */
  nameX: 482,
  titleX: 625,
} as const;

// ── Motion ──────────────────────────────────────────────────────────────────

/** How a lower third goes on and off air: animated, or a plain cut. */
export const LIVE_LOWER_THIRD_MOTIONS = ["animated", "cut"] as const;
export type LiveLowerThirdMotion = (typeof LIVE_LOWER_THIRD_MOTIONS)[number];
export const LIVE_LOWER_THIRD_MOTION_LABELS: Record<LiveLowerThirdMotion, string> = {
  animated: "Animated",
  cut: "Cut",
};
export const DEFAULT_LIVE_LOWER_THIRD_MOTION: LiveLowerThirdMotion = "animated";

/**
 * - `entering`: the emblem rolls in, then the name bar and the title bar come out of it;
 * - `exiting`: the reverse;
 * - `retracting`: one speaker replaces another; the bars go back into the emblem, which stays;
 * - `extending`: the bars come out again with the new name.
 */
export type LiveLowerThirdPhase = "idle" | "entering" | "shown" | "exiting" | "retracting" | "extending";

/** The lower third on screen, and the one waiting for the bars to retract before it shows. */
export interface LiveLowerThirdState<Credit extends { key: string }> {
  phase: LiveLowerThirdPhase;
  shown: Credit | null;
  incoming: Credit | null;
}

export type LiveLowerThirdEvent<Credit extends { key: string }> =
  | { type: "change"; credit: Credit | null; animate: boolean }
  /** The current phase's motion finished. */
  | { type: "done" };

/** What a lower third shows when it is first drawn: as it is, never replayed. */
export function initialLiveLowerThird<Credit extends { key: string }>(
  credit: Credit | null,
): LiveLowerThirdState<Credit> {
  return { phase: credit ? "shown" : "idle", shown: credit, incoming: null };
}

/**
 * The lower third's motion as a state machine. Only a change of who is on
 * air moves it; the same credit again (a re-render, a refreshed affiliation)
 * keeps it as it is. A cut skips every phase.
 */
export function stepLiveLowerThird<Credit extends { key: string }>(
  state: LiveLowerThirdState<Credit>,
  event: LiveLowerThirdEvent<Credit>,
): LiveLowerThirdState<Credit> {
  if (event.type === "done") {
    switch (state.phase) {
      case "entering":
      case "extending":
        return { ...state, phase: "shown" };
      case "exiting":
        return { phase: "idle", shown: null, incoming: null };
      case "retracting":
        return state.incoming
          ? { phase: "extending", shown: state.incoming, incoming: null }
          : { phase: "exiting", shown: state.shown, incoming: null };
      default:
        return state;
    }
  }
  const { credit, animate } = event;
  const target = state.phase === "retracting" ? state.incoming : state.phase === "exiting" ? null : state.shown;
  if (credit?.key === target?.key && (credit === null || state.phase !== "exiting")) {
    // The same lower third: only its content may have changed.
    return credit && state.phase !== "retracting" ? { ...state, shown: credit } : state;
  }
  if (!animate) return initialLiveLowerThird(credit);
  if (!credit) {
    // Off air: the bars and the emblem go, from wherever they are.
    return state.shown ? { phase: "exiting", shown: state.shown, incoming: null } : initialLiveLowerThird<Credit>(null);
  }
  if (!state.shown || state.phase === "exiting" || state.phase === "idle")
    return { phase: "entering", shown: credit, incoming: null };
  // Another speaker: the bars retract, the emblem stays, and the bars return with the new name.
  return { phase: "retracting", shown: state.shown, incoming: credit };
}
