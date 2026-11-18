import { liveOutputRole, type LiveAuxOutput } from "./live-room-outputs";
import type { LiveRoomOutput, LiveRoomOutputRole } from "./schemas/live-room-output-setup";
import { liveTimerCounts } from "./live-timer-policy";
import type { LiveStage, LiveTimer } from "./schemas/live-session-room";
import type { LiveScreenSync } from "./schemas/live-screen-sync";

/**
 * How a room screen follows Program, one rule for the projector and the
 * stage display: while it syncs, it shows what was put on it, and Program's
 * graphic wherever it has none of its own. Each screen follows only the
 * graphics that belong on it: the projector the boards and the timers the
 * room reads, not the stream's own graphics (the lower third, the ticker and
 * the panelists' names, which caption a camera picture the room does not
 * see); the stage display the question, the poll, the timers and the agenda
 * its footer reads. A
 * graphic a screen cannot draw does not take Program's place: the stage
 * display reads the time of day in its top row, so a clock of its own leaves
 * room for Program's countdowns.
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
  reactions: ["reactions"],
} as const satisfies Record<string, ReadonlyArray<keyof LiveStage>>;
export type LiveScreenGraphic = keyof typeof GRAPHICS;

/** The stream's own graphics: they caption the camera picture, so a room screen never copies them. */
const STREAM_ONLY: readonly LiveScreenGraphic[] = ["lowerThird", "ticker", "panelists"];

/** The roles that follow Program while they sync; an output that shows what you take to it never does. */
type LiveFollowingRole = Exclude<LiveRoomOutputRole, "exact">;

/** The graphics each kind of screen takes from Program while it syncs. */
export const LIVE_SCREEN_FOLLOWS: Record<LiveFollowingRole, readonly LiveScreenGraphic[]> = {
  follow: (Object.keys(GRAPHICS) as LiveScreenGraphic[]).filter((graphic) => !STREAM_ONLY.includes(graphic)),
  speaker: ["question", "poll", "timerGraphics", "schedule"],
};

/** Graphics the speaker's screen has no place for: they caption the stream or speak to the audience, not the speaker. */
const OFF_STAGE_DISPLAY: readonly LiveScreenGraphic[] = [...STREAM_ONLY, "topQuestions", "chatFeed"];

/** Whether an output can draw this graphic at all; the studio offers an output only for graphics it draws. */
export function liveScreenDraws(role: LiveRoomOutputRole | null, graphic: LiveScreenGraphic): boolean {
  return role !== "speaker" || !OFF_STAGE_DISPLAY.includes(graphic);
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
  return role !== null && role !== "exact" && LIVE_SCREEN_FOLLOWS[role].includes(graphic);
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
  for (const graphic of LIVE_SCREEN_FOLLOWS[role]) {
    if (holds(role, own, graphic, timers)) continue;
    for (const field of GRAPHICS[graphic]) shown[field] = program[field];
  }
  return shown as LiveStage;
}
