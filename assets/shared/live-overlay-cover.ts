import type { LiveStage } from "./schemas/live-session-room";
import {
  liveOverlayElementAlwaysOn,
  type LiveOverlayElementPlacement,
  type LiveOverlayLayoutElements,
} from "./schemas/live-overlay-layout";
import { liveOverlayClearOfTicker, liveProgramLayers, type LiveProgramLayer } from "./live-overlay-stacking";

/**
 * The graphics that take a spot of the frame: the boards and the cards, and
 * the background when a scene stacks it in front. Of two graphics in one
 * spot, the front one that is on shows and the one behind it does not.
 */
const BOARDS: ReadonlySet<LiveProgramLayer> = new Set([
  "background",
  "panelists",
  "schedule",
  "checkIn",
  "question",
  "poll",
  "topQuestions",
  "chat",
  "speakerWelcome",
]);

/** How much of a graphic a board must cover before it reads as hidden. */
const HIDDEN_SHARE = 0.6;

/** Whether a composition has something for this graphic to draw; one without a switch always has. */
export function liveOverlayDrawn(stage: LiveStage, layer: LiveProgramLayer): boolean {
  if (liveOverlayElementAlwaysOn(layer)) return true;
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
    case "speakerWelcome":
      return stage.speakerWelcome;
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
 * The outputs leave the hidden graphic out, and an operator sees that it is
 * on air but nobody sees it, such as Up next behind a full-screen question.
 */
export function liveOverlayCoveredBy(
  stage: LiveStage,
  scene: LiveOverlayLayoutElements,
  layer: LiveProgramLayer,
): LiveProgramLayer | null {
  // Drawn as the outputs draw it: clear of the ticker while the ticker is on air.
  const elements = liveOverlayClearOfTicker(scene, liveOverlayDrawn(stage, "ticker"));
  if (!elements[layer].visible || !liveOverlayDrawn(stage, layer)) return null;
  const stack = liveProgramLayers(elements);
  const above = stack.slice(stack.indexOf(layer) + 1);
  return (
    above.find(
      (board) =>
        BOARDS.has(board) &&
        elements[board].visible &&
        liveOverlayDrawn(stage, board) &&
        coveredShare(elements[layer], elements[board]) >= HIDDEN_SHARE,
    ) ?? null
  );
}
