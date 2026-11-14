import type { LiveAuxOutput } from "./live-room-outputs";
import { liveTimerCounts } from "./live-timer-policy";
import type { LiveStage, LiveTimer } from "./schemas/live-session-room";
import type { LiveScreenSync, LiveSyncedScreen } from "./schemas/live-screen-sync";

/**
 * How a room screen follows Program, one rule for the projector and the
 * stage display: while it syncs, it shows what was put on it, and Program's
 * graphic wherever it has none of its own. Each screen follows only the
 * graphics it can show: the projector all of them, the stage display the
 * question, the poll, the timers and the agenda its footer reads. A
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

const ALL_GRAPHICS = Object.keys(GRAPHICS) as LiveScreenGraphic[];

/** The graphics each screen takes from Program while it syncs. */
export const LIVE_SCREEN_FOLLOWS: Record<LiveSyncedScreen, readonly LiveScreenGraphic[]> = {
  projector: ALL_GRAPHICS,
  "stage-display": ["question", "poll", "timerGraphics", "schedule"],
};

/** Whether a screen holds a graphic of its own that it draws, so it takes the place of Program's. */
function holds(output: LiveSyncedScreen, stage: LiveStage, graphic: LiveScreenGraphic, timers: readonly LiveTimer[]) {
  if (output === "stage-display" && graphic === "timerGraphics")
    return stage.timerGraphics.some((shown) => {
      const timer = timers.find((entry) => entry.id === shown.timerId);
      return timer !== undefined && liveTimerCounts(timer);
    });
  const value = stage[graphic];
  return Array.isArray(value) ? value.length > 0 : value !== null && value !== false;
}

/** Whether an output syncs with Program now; the stage preview follows the room on its own and never does. */
export function liveScreenSyncs(sync: LiveScreenSync, output: LiveAuxOutput): output is LiveSyncedScreen {
  return output in sync && sync[output as LiveSyncedScreen];
}

/** Whether a screen takes this graphic from Program while it syncs. */
export function liveScreenFollows(output: LiveSyncedScreen, graphic: LiveScreenGraphic): boolean {
  return LIVE_SCREEN_FOLLOWS[output].includes(graphic);
}

/**
 * What a room screen shows: its own composition, and while it syncs,
 * Program's graphic for each one it follows and holds none of itself.
 */
export function liveScreenComposition(
  output: LiveAuxOutput,
  room: { own: LiveStage; program: LiveStage; sync: LiveScreenSync; timers: readonly LiveTimer[] },
): LiveStage {
  const { own, program, sync, timers } = room;
  if (!liveScreenSyncs(sync, output)) return own;
  const shown: Record<string, unknown> = { ...own };
  for (const graphic of LIVE_SCREEN_FOLLOWS[output]) {
    if (holds(output, own, graphic, timers)) continue;
    for (const field of GRAPHICS[graphic]) shown[field] = program[field];
  }
  return shown as LiveStage;
}
