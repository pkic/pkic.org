import type { LiveStage } from "./schemas/live-session-room";
import { liveOverlayElementAlwaysOn, type LiveOverlayLayoutElements } from "./schemas/live-overlay-layout";
import {
  LIVE_OVERLAY_BOARDS,
  liveBoxCovers,
  liveOverlaySpotOf,
  liveOverlaySpotTurns,
  liveOverlayTurnHolder,
  sameLiveBox,
} from "./live-overlay-spots";
import { liveOverlayClearOfTicker, liveProgramLayers, type LiveProgramLayer } from "./live-overlay-stacking";

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

/**
 * The board that hides a graphic on air in this layout: one drawn above it
 * that covers all of its box, or, in a spot that shows only its front board,
 * a board in front of it that is on. Null when the graphic shows, waits for
 * its turn, or is not drawn. The outputs leave the hidden graphic out, and an
 * operator sees that it is on air but nobody sees it, such as Up next behind
 * a full-screen question.
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
  const spot = liveOverlaySpotOf(elements, layer);
  const takesTurns = spot !== null && liveOverlaySpotTurns(elements, spot) !== null;
  const above = stack.slice(stack.indexOf(layer) + 1);
  return (
    above.find(
      (board) =>
        // The background covers like a board when a scene stacks it in front, unless it waits for a board: then it
        // only ever sits under the board on air, so it hides nothing.
        (LIVE_OVERLAY_BOARDS.has(board) || (board === "background" && elements.background.withBoardOnly !== true)) &&
        elements[board].visible &&
        liveOverlayDrawn(stage, board) &&
        (spot?.includes(board) ? !takesTurns : liveBoxCovers(elements[board], elements[layer])),
    ) ?? null
  );
}

/**
 * Whether a graphic on air waits for its turn: it is in a spot whose boards
 * take turns, and another board of the spot that is on holds the turn now.
 */
export function liveOverlayWaitsForTurn(
  stage: LiveStage,
  scene: LiveOverlayLayoutElements,
  layer: LiveProgramLayer,
  now: number,
): boolean {
  const elements = liveOverlayClearOfTicker(scene, liveOverlayDrawn(stage, "ticker"));
  if (!elements[layer].visible || !liveOverlayDrawn(stage, layer)) return false;
  const spot = liveOverlaySpotOf(elements, layer);
  const turns = spot ? liveOverlaySpotTurns(elements, spot) : null;
  if (!spot || turns === null) return false;
  const drawn = spot.filter((board) => liveOverlayDrawn(stage, board));
  // The question and panelists on air in one box draw as one board, so they take one turn, as the question.
  const joined =
    drawn.includes("question") && drawn.includes("panelists") && sameLiveBox(elements.question, elements.panelists);
  const holder = liveOverlayTurnHolder(joined ? drawn.filter((board) => board !== "panelists") : drawn, turns, now);
  return holder !== (joined && layer === "panelists" ? "question" : layer);
}
