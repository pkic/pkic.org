import { liveOutputRole, type LiveAuxOutput } from "./live-room-outputs";
import { liveCompositionInput } from "./live-room-preview";
import type { LiveRoomOutput, LiveRoomOutputRole } from "./schemas/live-room-output-setup";
import { liveTimerCounts } from "./live-timer-policy";
import {
  EMPTY_LIVE_STAGE,
  type LiveCompositionInput,
  type LiveRoomClientMessage,
  type LiveStage,
  type LiveTimer,
} from "./schemas/live-session-room";
import type { LiveScreenSync } from "./schemas/live-screen-sync";

/**
 * How a room screen follows Program. Whether a screen follows is the
 * screen's own property, its role and its sync, never a scene's.
 *
 * A screen with the role `follow` shows its own composition and nothing
 * else. A take puts Preview on it exactly. While it syncs, the room carries
 * every change of Program over to it: a graphic that goes on, comes off or
 * changes on Program does the same on the screen, and a graphic Program did
 * not touch stays as the screen has it. With sync off nothing reaches the
 * screen but what an operator puts there. It draws in its own scene, the one
 * its room fixed for it or the one last taken to it, so a graphic that scene
 * leaves out is not drawn.
 *
 * The speaker's screen draws its own layout instead of a scene. While it
 * syncs it shows what it holds itself, and Program's graphic wherever it
 * holds none of its own, for the graphics declared with its role: the
 * question, the poll, the timers and the agenda its footer reads. A graphic
 * it cannot draw does not take Program's place: the stage display reads the
 * time of day in its top row, so a clock of its own leaves room for
 * Program's countdowns.
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

/** Every graphic a composition holds: what the room carries from Program to a screen that follows it. */
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

/** The graphics a screen of each role shows from Program while it syncs and holds none of its own. */
const follows = (role: LiveFollowingRole): readonly LiveScreenGraphic[] =>
  role === "speaker" ? SPEAKER_SCREEN.follows : [];

/** Whether an output can draw this graphic at all; the studio offers an output only for graphics it draws. */
export function liveScreenDraws(role: LiveRoomOutputRole | null, graphic: LiveScreenGraphic): boolean {
  return role !== "speaker" || !(SPEAKER_SCREEN.neverDraws as readonly LiveScreenGraphic[]).includes(graphic);
}

/** Whether a graphic, or an operator's pick of one, is on. */
const isOn = (value: unknown) => (Array.isArray(value) ? value.length > 0 : value !== null && value !== false);

/** Whether a screen holds a graphic of its own that it draws, so it takes the place of Program's. */
function holds(role: LiveFollowingRole, stage: LiveStage, graphic: LiveScreenGraphic, timers: readonly LiveTimer[]) {
  if (role === "speaker" && graphic === "timerGraphics")
    return stage.timerGraphics.some((shown) => {
      const timer = timers.find((entry) => entry.id === shown.timerId);
      return timer !== undefined && liveTimerCounts(timer);
    });
  return isOn(stage[graphic]);
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

/** Whether an output of this role shows Program's graphic of this kind while it syncs and holds none of its own. */
export function liveScreenFollows(role: LiveRoomOutputRole | null, graphic: LiveScreenGraphic): boolean {
  return role !== null && role !== "exact" && follows(role).includes(graphic);
}

/** What a take to a room screen sends: the shot the screen shows from then on. */
export type LiveScreenTake = Extract<LiveRoomClientMessage, { type: "aux.set" }>;

/**
 * What a take to a room screen sends: Preview as it is, scene included, so
 * the screen shows exactly what Preview showed. The speaker's screen alone
 * takes the shot without the graphics it shows from Program while it syncs,
 * so none of Preview's shows there before it is on Program.
 */
export function liveScreenTake(
  output: LiveAuxOutput,
  room: { shot: LiveStage; sync: LiveScreenSync; outputs: readonly LiveRoomOutput[] },
): LiveScreenTake {
  const { shot, sync, outputs } = room;
  const role = followingRole(sync, outputs, output);
  const taken: Record<string, unknown> = { ...shot };
  if (role)
    for (const graphic of follows(role)) for (const field of GRAPHICS[graphic]) taken[field] = EMPTY_LIVE_STAGE[field];
  return { type: "aux.set", output, composition: liveCompositionInput(taken as LiveStage) };
}

/** Whether an output is a screen the room carries Program's changes to now. */
export function liveScreenTakesProgramChanges(
  sync: LiveScreenSync,
  outputs: readonly LiveRoomOutput[],
  output: LiveAuxOutput,
): boolean {
  return followingRole(sync, outputs, output) === "follow";
}

/**
 * What an operator chose for each graphic, among a composition's sources:
 * first whether it is on and which one, then how it looks. Content the room
 * fills in again by itself, such as the agenda or a ticker's text, is no
 * choice, so a refresh of it is no change.
 */
const PICKS = {
  question: ["questionId"],
  lowerThird: ["creditKey", "lowerThirdMotion"],
  poll: ["pollId", "pollPresentation"],
  ticker: ["ticker"],
  panelists: ["panelists"],
  schedule: ["schedule"],
  checkIn: ["checkIn", "checkInTheme", "checkInText"],
  timerGraphics: ["timerGraphics"],
  topQuestions: ["topQuestions"],
  chatFeed: ["chatFeed"],
  reactions: ["reactions", "reactionsGraphic"],
} as const satisfies Record<LiveScreenGraphic, ReadonlyArray<keyof LiveCompositionInput>>;

/** Whether an operator's change to Program changed this graphic: which one it shows, or how one it shows looks. */
function picksChanged(before: LiveCompositionInput, after: LiveCompositionInput, graphic: LiveScreenGraphic) {
  const differs = (pick: keyof LiveCompositionInput) => JSON.stringify(before[pick]) !== JSON.stringify(after[pick]);
  const [shown, ...looks] = PICKS[graphic];
  return differs(shown) || (isOn(after[shown]) && looks.some(differs));
}

const copied = (own: LiveStage, program: LiveStage, graphics: readonly LiveScreenGraphic[]): LiveStage => {
  const next: Record<string, unknown> = { ...own };
  for (const graphic of graphics) for (const field of GRAPHICS[graphic]) next[field] = program[field];
  return next as LiveStage;
};

/**
 * What a screen that follows Program holds once Program changed: Program's
 * graphic for each one that changed, and everything else as the screen had
 * it, its scene included. Null when no graphic changed.
 */
export function liveScreenAfterProgramChange(own: LiveStage, before: LiveStage, after: LiveStage): LiveStage | null {
  const [was, now] = [liveCompositionInput(before), liveCompositionInput(after)];
  const changed = EVERY_GRAPHIC.filter((graphic) => picksChanged(was, now, graphic));
  return changed.length ? copied(own, after, changed) : null;
}

/** What a screen holds once it starts following Program again: every graphic as Program has it, in its own scene. */
export function liveScreenCaughtUp(own: LiveStage, program: LiveStage): LiveStage {
  return copied(own, program, EVERY_GRAPHIC);
}

/**
 * What a room screen shows: its own composition. The speaker's screen also
 * shows, while it syncs, Program's graphic for each one it follows and holds
 * none of itself.
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
  if (role !== "speaker") return own;
  const shown: Record<string, unknown> = { ...own };
  for (const graphic of follows(role)) {
    if (holds(role, own, graphic, timers)) continue;
    for (const field of GRAPHICS[graphic]) shown[field] = program[field];
  }
  return shown as LiveStage;
}
