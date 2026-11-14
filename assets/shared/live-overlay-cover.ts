import type { LiveStage } from "./schemas/live-session-room";
import type {
  LiveOverlayElement,
  LiveOverlayElementPlacement,
  LiveOverlayLayoutElements,
} from "./schemas/live-overlay-layout";

/** Program's graphics, bottom to top: a later one draws over an earlier one where their boxes meet. */
export const LIVE_PROGRAM_LAYER_ORDER = [
  "panelists",
  "schedule",
  "checkIn",
  "question",
  "lowerThird",
  "poll",
  "topQuestions",
  "chat",
  "timer",
  "ticker",
  "reactions",
] as const satisfies readonly LiveOverlayElement[];
export type LiveProgramLayer = (typeof LIVE_PROGRAM_LAYER_ORDER)[number];

/** The boards: graphics on a solid field, which hide whatever sits under them. */
const BOARDS: ReadonlySet<LiveProgramLayer> = new Set([
  "panelists",
  "schedule",
  "checkIn",
  "question",
  "poll",
  "topQuestions",
  "chat",
]);

/** How much of a graphic a board must cover before it reads as hidden. */
const HIDDEN_SHARE = 0.6;

/** Whether a composition has something for this graphic to draw. */
function drawn(stage: LiveStage, layer: LiveProgramLayer): boolean {
  switch (layer) {
    case "panelists":
      return stage.panelists !== null;
    case "schedule":
      return stage.schedule !== null;
    case "checkIn":
      return stage.checkIn !== null;
    case "question":
      return stage.question !== null;
    case "lowerThird":
      return stage.lowerThird !== null;
    case "poll":
      return stage.poll !== null;
    case "topQuestions":
      return (stage.topQuestions?.questions.length ?? 0) > 0;
    case "chat":
      return (stage.chatFeed?.messages.length ?? 0) > 0;
    case "timer":
      return stage.timerGraphics.length > 0;
    case "ticker":
      return (stage.ticker?.segments.length ?? 0) > 0;
    case "reactions":
      return stage.reactions;
  }
}

/** The share of `under` that `over` covers. */
function coveredShare(under: LiveOverlayElementPlacement, over: LiveOverlayElementPlacement): number {
  const w = Math.min(under.x + under.w, over.x + over.w) - Math.max(under.x, over.x);
  const h = Math.min(under.y + under.h, over.y + over.h) - Math.max(under.y, over.y);
  if (w <= 0 || h <= 0 || under.w <= 0 || under.h <= 0) return 0;
  return (w * h) / (under.w * under.h);
}

/**
 * The board that hides a graphic on air in this layout: one drawn above it
 * that covers most of its box. Null when the graphic shows, or is not drawn.
 * An operator then sees that a graphic is on air but nobody sees it, such as
 * Up next behind a full-screen question.
 */
export function liveOverlayCoveredBy(
  stage: LiveStage,
  elements: LiveOverlayLayoutElements,
  layer: LiveProgramLayer,
): LiveProgramLayer | null {
  if (!elements[layer].visible || !drawn(stage, layer)) return null;
  const above = LIVE_PROGRAM_LAYER_ORDER.slice(LIVE_PROGRAM_LAYER_ORDER.indexOf(layer) + 1);
  return (
    above.find(
      (board) =>
        BOARDS.has(board) &&
        elements[board].visible &&
        drawn(stage, board) &&
        coveredShare(elements[layer], elements[board]) >= HIDDEN_SHARE,
    ) ?? null
  );
}
