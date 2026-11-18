import {
  LIVE_OVERLAY_ELEMENTS,
  liveOverlayElementFillsItself,
  type LiveOverlayLayoutElements,
  type LiveSelfFillingElement,
} from "./schemas/live-overlay-layout";
import { DEFAULT_LIVE_CHAT_FEED_CONFIG, DEFAULT_LIVE_TOP_QUESTIONS_CONFIG } from "./schemas/live-session-on-screen";
import type { LiveCompositionInput, LivePanelists, LiveRoomSession, LiveStage } from "./schemas/live-session-room";
import { DEFAULT_LIVE_SCHEDULE_CONFIG } from "./schemas/live-session-schedule";
import { DEFAULT_LIVE_TICKER_CONFIG } from "./schemas/live-session-ticker";

/**
 * What loading a scene switches on. A scene says, per graphic that fills
 * itself from the room, whether it comes on with the scene (`comesOn`);
 * loading the scene on an output switches those on, filled from the room.
 * It never switches a graphic off, never changes one that is already on,
 * and never touches a graphic that needs a pick or one the scene leaves to
 * the studio. Driven only by the scene's own setting, so a built-in scene
 * and one of the event's own behave the same.
 */

/** The panel's layout when a scene brings it on and Program shows none. */
export const DEFAULT_LIVE_PANELISTS: LivePanelists = { layout: "panel" };

/** A line-up of every speaker only means something when there is more than one. */
export function liveSessionHasPanel(creditCount: number): boolean {
  return creditCount > 1;
}

/** What the fill reads from the room: who the session credits, and how Program shows each graphic now. */
export type LiveSceneFillRoom = { session: Pick<LiveRoomSession, "credits">; program: LiveStage };

/** The sources a scene switches on, as part of a composition. */
export type LiveSceneFill = Partial<LiveCompositionInput>;

/**
 * Each self-filling graphic's sources as a scene switches it on: the look
 * Program gives it now, else the standard one. Null when the composition
 * already has it on, or the room has nothing to fill it with.
 */
const FILLS: Record<
  LiveSelfFillingElement,
  (input: LiveCompositionInput, room: LiveSceneFillRoom) => LiveSceneFill | null
> = {
  ticker: (input, { program }) =>
    input.ticker
      ? null
      : {
          ticker: program.ticker
            ? { style: program.ticker.style, messages: program.ticker.messages }
            : DEFAULT_LIVE_TICKER_CONFIG,
        },
  // Up next lists every room, as the studio's own switch puts it on.
  schedule: (input, { program }) =>
    input.schedule
      ? null
      : { schedule: { ...(program.schedule?.config ?? DEFAULT_LIVE_SCHEDULE_CONFIG), scope: "all-rooms" } },
  panelists: (input, { program, session }) =>
    input.panelists || !liveSessionHasPanel(session.credits.length)
      ? null
      : { panelists: program.panelists ?? DEFAULT_LIVE_PANELISTS },
  topQuestions: (input, { program }) =>
    input.topQuestions ? null : { topQuestions: program.topQuestions?.config ?? DEFAULT_LIVE_TOP_QUESTIONS_CONFIG },
  chat: (input, { program }) =>
    input.chatFeed ? null : { chatFeed: program.chatFeed?.config ?? DEFAULT_LIVE_CHAT_FEED_CONFIG },
  reactions: (input) => (input.reactions ? null : { reactions: true }),
};

/** The graphics that come on with a scene: the self-filling ones it includes and sets to come on. */
export function liveSceneComesOn(scene: LiveOverlayLayoutElements): LiveSelfFillingElement[] {
  return LIVE_OVERLAY_ELEMENTS.filter(liveOverlayElementFillsItself).filter(
    (element) => scene[element].visible && scene[element].comesOn === true,
  );
}

/**
 * What loading `scene` on a composition switches on, for any output: the
 * sources of each graphic that comes on with the scene and is off there now.
 * Merge it over the composition's sources; the room fills the content.
 */
export function liveSceneFill(
  scene: LiveOverlayLayoutElements,
  input: LiveCompositionInput,
  room: LiveSceneFillRoom,
): LiveSceneFill {
  return Object.assign({}, ...liveSceneComesOn(scene).map((element) => FILLS[element](input, room) ?? {}));
}
