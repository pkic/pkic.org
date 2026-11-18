import { liveOutputRole, type LiveAuxOutput } from "./live-room-outputs";
import { liveCompositionInput } from "./live-room-preview";
import type { LiveRoomOutput, LiveRoomOutputRole } from "./schemas/live-room-output-setup";
import { liveTimerCounts } from "./live-timer-policy";
import {
  EMPTY_LIVE_STAGE,
  type LiveRoomClientMessage,
  type LiveStage,
  type LiveTimer,
} from "./schemas/live-session-room";
import type { LiveScreenSync } from "./schemas/live-screen-sync";

/**
 * How a room screen follows Program, one rule for every screen that does:
 * while it syncs, it shows what it holds itself, and Program's graphic
 * wherever it holds none of its own. Whether a screen follows is the
 * screen's own property, its role and its sync, never a scene's.
 *
 * A screen with the role `follow` takes every graphic from Program, each
 * with its pick. It draws them in its own scene, the one its room fixed for
 * it or the one last taken to it, so the scene alone decides which of them
 * show there: one the scene leaves out is not drawn. A graphic that comes on
 * with the screen's scene is one the screen holds itself, so it stays on
 * whatever Program shows.
 *
 * The speaker's screen draws its own layout instead of a scene, so what it
 * takes from Program is declared with its role: the question, the poll, the
 * timers and the agenda its footer reads. A graphic a screen cannot draw
 * does not take Program's place: the stage display reads the time of day in
 * its top row, so a clock of its own leaves room for Program's countdowns.
 */

/** A graphic of a composition, with the fields that travel with it. */
const GRAPHICS = {
  question: ["question", "questionChange"],
  lowerThird: ["lowerThird", "lowerThirdChange", "lowerThirdMotion"],
  poll: ["poll", "pollChange"],
  ticker: ["ticker"],
  panelists: ["panelists"],
  schedule: ["schedule"],
  checkIn: ["checkIn"],
  timerGraphics: ["timerGraphics"],
  topQuestions: ["topQuestions"],
  chatFeed: ["chatFeed"],
  reactions: ["reactions", "reactionsGraphic"],
} as const satisfies Record<string, ReadonlyArray<keyof LiveStage>>;
export type LiveScreenGraphic = keyof typeof GRAPHICS;

/** The roles that follow Program while they sync; an output that shows what you take to it never does. */
type LiveFollowingRole = Exclude<LiveRoomOutputRole, "exact">;

/** Every graphic a composition holds: what a screen that follows Program takes from it. */
const EVERY_GRAPHIC = Object.keys(GRAPHICS) as LiveScreenGraphic[];

/**
 * The speaker's screen, which draws its own layout: the graphics it takes
 * from Program while it syncs, and the ones it has no place for, which
 * caption the stream or speak to the audience, not the speaker.
 */
const SPEAKER_SCREEN = {
  follows: ["question", "poll", "timerGraphics", "schedule"],
  neverDraws: ["lowerThird", "ticker", "panelists", "topQuestions", "chatFeed"],
} as const satisfies Record<string, readonly LiveScreenGraphic[]>;

/** The graphics a screen of each role takes from Program while it syncs. */
const follows = (role: LiveFollowingRole): readonly LiveScreenGraphic[] =>
  role === "speaker" ? SPEAKER_SCREEN.follows : EVERY_GRAPHIC;

/** Whether an output can draw this graphic at all; the studio offers an output only for graphics it draws. */
export function liveScreenDraws(role: LiveRoomOutputRole | null, graphic: LiveScreenGraphic): boolean {
  return role !== "speaker" || !(SPEAKER_SCREEN.neverDraws as readonly LiveScreenGraphic[]).includes(graphic);
}

/** Whether a screen holds a graphic of its own that it draws, so it takes the place of Program's. */
function holds(role: LiveFollowingRole, stage: LiveStage, graphic: LiveScreenGraphic, timers: readonly LiveTimer[]) {
  if (role === "speaker" && graphic === "timerGraphics")
    return stage.timerGraphics.some((shown) => {
      const timer = timers.find((entry) => entry.id === shown.timerId);
      return timer !== undefined && liveTimerCounts(timer);
    });
  const value = stage[graphic];
  return Array.isArray(value) ? value.length > 0 : value !== null && value !== false;
}

/** How an output follows Program now, or null when it does not: on by default, off once an operator turns it off. */
function followingRole(
  sync: LiveScreenSync,
  outputs: readonly LiveRoomOutput[],
  output: LiveAuxOutput,
): LiveFollowingRole | null {
  const role = liveOutputRole(outputs, output);
  if (role === null || role === "exact") return null;
  return sync[output] === false ? null : role;
}

/**
 * Whether an output syncs with Program now. One that shows what you take to
 * it never does, nor does the stage preview, which follows the room on its own.
 */
export function liveScreenSyncs(
  sync: LiveScreenSync,
  outputs: readonly LiveRoomOutput[],
  output: LiveAuxOutput,
): boolean {
  return followingRole(sync, outputs, output) !== null;
}

/** Whether an output of this role takes this graphic from Program while it syncs. */
export function liveScreenFollows(role: LiveRoomOutputRole | null, graphic: LiveScreenGraphic): boolean {
  return role !== null && role !== "exact" && follows(role).includes(graphic);
}

/** What a take to a room screen sends: a whole shot, or only a scene. */
export type LiveScreenTake = Extract<LiveRoomClientMessage, { type: "aux.set" | "aux.scene" }>;

/**
 * What a take to a room screen sends. A screen that follows Program takes
 * Preview's scene and nothing else: the room starts the screen again in that
 * scene with the graphics that come on with it, and every other switch and
 * pick stays Program's. A screen that shows what you take to it, or one
 * whose sync is off, takes the whole shot. The speaker's screen takes the
 * shot without the graphics it follows, so none of Preview's shows there
 * before it is on Program.
 */
export function liveScreenTake(
  output: LiveAuxOutput,
  room: { shot: LiveStage; sync: LiveScreenSync; outputs: readonly LiveRoomOutput[] },
): LiveScreenTake {
  const { shot, sync, outputs } = room;
  const role = followingRole(sync, outputs, output);
  if (role === "follow") return { type: "aux.scene", output, scene: shot.scene };
  const taken: Record<string, unknown> = { ...shot };
  if (role)
    for (const graphic of follows(role)) for (const field of GRAPHICS[graphic]) taken[field] = EMPTY_LIVE_STAGE[field];
  return { type: "aux.set", output, composition: liveCompositionInput(taken as LiveStage) };
}

/**
 * What a room screen shows: its own composition, and while it syncs,
 * Program's graphic for each one it follows and holds none of itself.
 */
export function liveScreenComposition(
  output: LiveAuxOutput,
  room: {
    own: LiveStage;
    program: LiveStage;
    sync: LiveScreenSync;
    timers: readonly LiveTimer[];
    outputs: readonly LiveRoomOutput[];
  },
): LiveStage {
  const { own, program, sync, timers, outputs } = room;
  const role = followingRole(sync, outputs, output);
  if (!role) return own;
  const shown: Record<string, unknown> = { ...own };
  for (const graphic of follows(role)) {
    if (holds(role, own, graphic, timers)) continue;
    for (const field of GRAPHICS[graphic]) shown[field] = program[field];
  }
  return shown as LiveStage;
}
