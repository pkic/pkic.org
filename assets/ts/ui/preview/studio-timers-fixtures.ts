/**
 * Synthetic timers for the Time panel and stage display specimens: one room
 * on a fixed clock, nineteen days before its session, so every screenshot
 * reads the same.
 */
import { DEFAULT_LIVE_STAGE_DISPLAY_SETTINGS } from "../../../shared/schemas/live-stage-display-settings";
import { sessionLiveTimer } from "../../../shared/live-timer-policy";
import { DEFAULT_LIVE_TICKER_CONTEXT } from "../../../shared/schemas/live-session-ticker";
import {
  EMPTY_LIVE_AUX_COMPOSITION,
  EMPTY_LIVE_OUTPUTS,
  type LiveRoomSnapshot,
  type LiveTimer,
} from "../../../shared/schemas/live-session-room";
import { defaultLiveTimerGraphic, type LiveTimerGraphic } from "../../../shared/schemas/live-session-timer";
import { applyLiveRoomMessage, type LiveRoomState } from "../../live-session/live-room-state";

/** The instant the specimens are drawn at. */
export const TIMERS_FIXTURE_NOW = Date.parse("2026-11-12T10:00:00.000Z");
const at = (ms: number) => new Date(TIMERS_FIXTURE_NOW + ms).toISOString();
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export const TIMERS_FIXTURE_SESSION = {
  occurrenceId: "30000000-0000-4000-8000-000000000021",
  title: "Opening keynote",
  startAt: "2026-12-01T08:30:00.000Z",
  endAt: "2026-12-01T09:00:00.000Z",
  timeZone: "Europe/Amsterdam",
  credits: [],
};

const base = sessionLiveTimer();
const running = (id: string, name: string, kind: LiveTimer["kind"], leftMs: number, extra: Partial<LiveTimer> = {}) =>
  ({
    ...base,
    id,
    name,
    kind,
    followsAgenda: false,
    running: true,
    anchorAt: at(leftMs),
    heldMs: 0,
    ...extra,
  }) satisfies LiveTimer;

/** The session timer, following the agenda: nineteen days before its session it reads the time until it starts. */
export const agendaSessionTimer: LiveTimer = base;
/** A three-minute pitch that resets itself ten seconds over and buzzes on the outputs that show it. */
export const pitchTimer = running("pitch", "Pitch", "duration", 42_000, {
  durationSeconds: 180,
  atZero: { action: "reset", resetAfterSeconds: 10, restart: false },
  sound: { places: ["outputs"], warningSeconds: 30, zero: true },
});
/** A pitch left counting as overtime, 1:21 over. */
export const overrunPitchTimer = running("pitch-over", "Pitch", "duration", -81_000, { durationSeconds: 180 });
export const lunchTimer = running("lunch", "Lunch", "until", 2 * 60 * MINUTE + 15 * MINUTE, {
  targetAt: at(2 * 60 * MINUTE + 15 * MINUTE),
  durationSeconds: 3 * 3600,
});
export const doorsTimer = running("doors", "Doors open", "until", 3 * DAY + 4 * 60 * MINUTE + 12 * MINUTE, {
  targetAt: at(3 * DAY + 4 * 60 * MINUTE + 12 * MINUTE),
  durationSeconds: 4 * 86400,
});
export const qDayTimer = running("q-day", "Q-day", "until", (4 * 365 + 210) * DAY, {
  targetAt: at((4 * 365 + 210) * DAY),
  durationSeconds: 5 * 365 * 86400,
  atZero: { action: "stop", resetAfterSeconds: 10, restart: false },
});
/** The time of day on the event's clock. */
export const clockTimer: LiveTimer = { ...base, id: "clock", name: "Clock", kind: "clock", followsAgenda: false };
export const breakTimer: LiveTimer = {
  ...base,
  id: "break",
  name: "Break",
  kind: "stopwatch",
  followsAgenda: false,
  heldMs: 4 * MINUTE + 12_000,
};

/** A room holding these timers, with these graphics on its stage display. */
export function timersRoomState(
  timers: LiveTimer[],
  stageDisplay: LiveTimerGraphic[] = [],
  overrides: Partial<Omit<LiveRoomSnapshot, "type">> = {},
): LiveRoomState {
  const snapshot: LiveRoomSnapshot = {
    type: "room.snapshot",
    overlayLayouts: [],
    tickerContext: DEFAULT_LIVE_TICKER_CONTEXT,
    session: TIMERS_FIXTURE_SESSION,
    viewer: { role: "operator", name: "Studio operator" },
    overlayMode: "direct",
    chat: [],
    questions: [],
    polls: [],
    stage: { ...EMPTY_LIVE_AUX_COMPOSITION, timerGraphics: [defaultLiveTimerGraphic(base.id)] },
    outputs: {
      ...EMPTY_LIVE_OUTPUTS,
      "stage-display": { ...EMPTY_LIVE_AUX_COMPOSITION, timerGraphics: stageDisplay },
    },
    speakerMessage: null,
    preview: { ...EMPTY_LIVE_AUX_COMPOSITION, timerGraphics: [defaultLiveTimerGraphic(pitchTimer.id)] },
    timers,
    reactionTotals: {},
    queue: { question: [], "lower-third": [], poll: [], change: null },
    operators: [],
    addedCredits: [],
    stageDisplayNext: null,
    stageDisplayNextVotes: null,
    stageDisplaySettings: DEFAULT_LIVE_STAGE_DISPLAY_SETTINGS,
    ...overrides,
  };
  return applyLiveRoomMessage(null, snapshot)!;
}

/** One timer alone on the stage display, under the graphic's default settings. */
export const stageDisplayWith = (timer: LiveTimer) =>
  timersRoomState([timer], [{ ...defaultLiveTimerGraphic(timer.id) }]);

/**
 * A session under way with its timer, a pitch and the clock on the stage
 * display, and the operators' message over them: 11:00 in Amsterdam.
 */
export const stageClockState = timersRoomState(
  [agendaSessionTimer, pitchTimer, clockTimer],
  [
    defaultLiveTimerGraphic(agendaSessionTimer.id),
    defaultLiveTimerGraphic(pitchTimer.id),
    defaultLiveTimerGraphic(clockTimer.id),
  ],
  {
    session: {
      ...TIMERS_FIXTURE_SESSION,
      title: "Panel: migrating a private CA",
      startAt: at(-15 * MINUTE),
      endAt: at(15 * MINUTE),
    },
    speakerMessage: { text: "Two minutes for questions", tone: "warning", flash: false, change: null },
  },
);
