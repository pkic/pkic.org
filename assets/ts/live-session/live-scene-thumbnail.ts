import { liveOverlayDrawn } from "../../shared/live-overlay-cover";
import { selectLiveTopQuestions } from "../../shared/live-on-screen-lists";
import { mergeLivePreview } from "../../shared/live-room-preview";
import { resolveLiveSceneElements } from "../../shared/live-scene-elements";
import { liveSceneFill, type LiveSceneFill } from "../../shared/live-scene-fill";
import { resolveUpcomingRooms } from "../../shared/live-session-schedule";
import { LIVE_PROGRAM_LAYER_ORDER } from "../../shared/live-overlay-stacking";
import { resolveTickerMessages } from "../../shared/live-ticker-content";
import type { AgendaSnapshot } from "../../shared/schemas/event-agenda";
import {
  liveOverlayElementAlwaysOn,
  type LiveOverlayElement,
  type LiveOverlayElementPlacement,
  type LiveSelfFillingElement,
} from "../../shared/schemas/live-overlay-layout";
import { EMPTY_LIVE_STAGE, type LiveStage } from "../../shared/schemas/live-session-stage";
import type { LiveRoomState } from "./live-room-state";
import { liveTickerConfigOf } from "../../shared/schemas/live-session-ticker";

/**
 * A scene's thumbnail draws what Preview shows once the scene is loaded
 * now: Preview's switches and picks laid out in that scene, with the scene's
 * comes-on graphics switched on and filled from the room. `liveSceneFill`
 * decides which graphics come on, as it does in the room, and the content is
 * the room's own: the questions, credits, agenda and compositions the studio
 * already holds. Nothing is sampled or made up.
 */

/** What the thumbnails read from the studio. */
export interface LiveSceneThumbnailRoom {
  /** The room with Preview's composition as its stage. */
  preview: LiveRoomState;
  /** The session's own Program, whose looks a scene's graphics take; null while the studio does not hold it. */
  program: LiveStage | null;
  /** The approved agenda Up next and the ticker read; null before the first approval. */
  agenda: AgendaSnapshot | null;
}

/** One scene's thumbnail. */
export interface LiveSceneThumbnail {
  /** The room as Preview shows it once the scene is loaded; still, without reaction bursts. */
  state: LiveRoomState;
  /** Graphics that come on with the scene whose content only the room holds: drawn as their boxes. */
  unfilled: readonly LiveSelfFillingElement[];
}

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

/** The compositions the room has filled already: its Program and its screens. */
function held(room: LiveSceneThumbnailRoom): LiveStage[] {
  return [...(room.program ? [room.program] : []), ...Object.values(room.preview.outputs)];
}

/** The open questions with the most votes, as the room lists them; an anonymous author stays anonymous. */
function topQuestions(
  config: NonNullable<LiveSceneFill["topQuestions"]>,
  room: LiveSceneThumbnailRoom,
): LiveStage["topQuestions"] {
  return {
    config,
    questions: selectLiveTopQuestions(room.preview.questions, config.count).map((question) => ({
      id: question.id,
      text: question.text,
      authorName: question.anonymous ? null : question.authorName,
      votes: question.votes,
    })),
  };
}

/**
 * The ticker's lines: those of a composition the room filled from the same
 * messages, else written from the agenda as the room writes them. A scene
 * brings Program's ticker or the standard one, and only Program's can quote
 * the chat, whose lines the room alone holds.
 */
function ticker(
  config: NonNullable<LiveSceneFill["ticker"]>,
  room: LiveSceneThumbnailRoom,
  now: number,
): LiveStage["ticker"] {
  const filled = held(room).find(
    (composition) => composition.ticker && same(liveTickerConfigOf(composition.ticker), config),
  );
  if (filled) return filled.ticker;
  const { session, tickerContext } = room.preview;
  return {
    ...config,
    segments: resolveTickerMessages(config, room.agenda, session.occurrenceId, now, tickerContext),
  };
}

/**
 * The graphics a scene switches on, with the room's content. The chat is
 * the one list only the room can fill, after its moderation and its wait:
 * the thumbnail shows it when an output already holds the same list, and
 * leaves it to its box otherwise.
 */
function fillContent(
  fill: LiveSceneFill,
  room: LiveSceneThumbnailRoom,
  now: number,
): { stage: Partial<LiveStage>; unfilled: LiveSelfFillingElement[] } {
  const stage: Partial<LiveStage> = {};
  const unfilled: LiveSelfFillingElement[] = [];
  if (fill.panelists) stage.panelists = fill.panelists;
  if (fill.reactions) stage.reactions = true;
  if (fill.topQuestions) stage.topQuestions = topQuestions(fill.topQuestions, room);
  if (fill.schedule)
    stage.schedule = resolveUpcomingRooms(room.agenda, room.preview.session.occurrenceId, now, fill.schedule);
  if (fill.ticker) stage.ticker = ticker(fill.ticker, room, now);
  if (fill.chatFeed) {
    const filled = held(room).find((composition) => same(composition.chatFeed?.config, fill.chatFeed));
    if (filled) stage.chatFeed = filled.chatFeed;
    else unfilled.push("chat");
  }
  return { stage, unfilled };
}

/** What one scene's thumbnail draws at `now`: Preview with the scene loaded, as the room would compose it. */
export function liveSceneThumbnail(room: LiveSceneThumbnailRoom, scene: string, now: number): LiveSceneThumbnail {
  const { preview } = room;
  const fill = liveSceneFill(resolveLiveSceneElements(preview, scene), mergeLivePreview(preview.stage, { scene }), {
    program: room.program ?? EMPTY_LIVE_STAGE,
  });
  const { stage, unfilled } = fillContent(fill, room, now);
  return { state: { ...preview, stage: { ...preview.stage, scene, ...stage }, burst: null }, unfilled };
}

/**
 * Whether two rooms give the same thumbnails. Chat, presence and the queue
 * leave them alone: the chat an output shows arrives in that output's
 * composition, never from the chat itself.
 */
export function sameLiveSceneThumbnailRoom(previous: LiveSceneThumbnailRoom, next: LiveSceneThumbnailRoom): boolean {
  const left = previous.preview;
  const right = next.preview;
  return (
    left.stage === right.stage &&
    sameSurroundings(left, right) &&
    left.questions === right.questions &&
    left.outputs === right.outputs &&
    left.tickerContext === right.tickerContext &&
    previous.program === next.program &&
    previous.agenda === next.agenda
  );
}

/** The parts of the room a picture draws from besides its composition. */
function sameSurroundings(left: LiveRoomState, right: LiveRoomState): boolean {
  return (
    left.session === right.session &&
    left.timers === right.timers &&
    left.polls === right.polls &&
    left.overlayLayouts === right.overlayLayouts &&
    left.speakerMessage === right.speakerMessage
  );
}

/** Whether two thumbnails of a scene draw the same picture, so the earlier one can stay as it is. */
function samePicture(left: LiveSceneThumbnail, right: LiveSceneThumbnail): boolean {
  return (
    sameSurroundings(left.state, right.state) &&
    same(left.state.stage, right.state.stage) &&
    same(left.unfilled, right.unfilled)
  );
}

/**
 * Every scene's thumbnail at `now`. A scene whose picture is what it was
 * keeps its earlier thumbnail, so a vote that leaves the top questions as
 * they are, or an agenda read again, redraws nothing.
 */
export function liveSceneThumbnails(
  room: LiveSceneThumbnailRoom,
  scenes: readonly string[],
  now: number,
  previous: ReadonlyMap<string, LiveSceneThumbnail> = new Map(),
): Map<string, LiveSceneThumbnail> {
  return new Map(
    scenes.map((scene) => {
      const next = liveSceneThumbnail(room, scene, now);
      const earlier = previous.get(scene);
      return [scene, earlier && samePicture(earlier, next) ? earlier : next];
    }),
  );
}

/** The graphics with a switch, which an output can have on; the background and the QR code come with the scene itself. */
const OPERATOR_GRAPHICS = LIVE_PROGRAM_LAYER_ORDER.filter((layer) => !liveOverlayElementAlwaysOn(layer));

/** The scene's own boxes, outside the stage display's: an empty thumbnail outlines them so each scene stays recognizable. */
const OUTLINED: readonly LiveOverlayElement[] = [...OPERATOR_GRAPHICS, "qrCode"];

/** Whether a composition holds no graphic, so its thumbnail draws only the scene. */
export function liveSceneThumbnailEmpty(stage: LiveStage): boolean {
  return !OPERATOR_GRAPHICS.some((graphic) => liveOverlayDrawn(stage, graphic));
}

/**
 * The boxes a thumbnail outlines faintly: every box of the scene while the
 * thumbnail holds no graphic, else only those of the graphics that come on
 * with the scene and whose content the room alone holds.
 */
export function liveSceneOutline(thumbnail: LiveSceneThumbnail, scene: string): LiveOverlayElementPlacement[] {
  const elements = resolveLiveSceneElements(thumbnail.state, scene);
  const outlined = liveSceneThumbnailEmpty(thumbnail.state.stage) ? OUTLINED : thumbnail.unfilled;
  return outlined.map((element) => elements[element]).filter((placement) => placement.visible);
}
