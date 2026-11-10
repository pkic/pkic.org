import type { ScreenAgendaSession } from "../../shared/schemas/event-screens";
import { DEFAULT_LIVE_TICKER_CONTEXT } from "../../shared/schemas/live-session-ticker";
import {
  EMPTY_LIVE_AUX_COMPOSITION,
  EMPTY_LIVE_OUTPUTS,
  type LiveRoomSnapshot,
} from "../../shared/schemas/live-session-room";
import { DEFAULT_LIVE_SCHEDULE_CONFIG, type LiveScheduleProjection } from "../../shared/schemas/live-session-schedule";
import { defaultLiveTimerGraphic, type LiveTimer } from "../../shared/schemas/live-session-timer";
import { LIVE_SESSION_TIMER_ID } from "../../shared/live-timer-policy";
import { applyLiveRoomMessage, type LiveRoomState } from "../live-session/live-room-state";
import type { ScreenCachedAgenda } from "./screen-cache";

/** The countdown to the next session's start, which auto mode shows before it begins. */
const STARTS_IN_TIMER_ID = "starts-in";

/** Where the room is on its agenda at `now`: the session under way, else the next one, and the one after. */
export function screenAgendaMoment(sessions: readonly ScreenAgendaSession[], now: number) {
  const ordered = [...sessions].sort((a, b) => a.startAt.localeCompare(b.startAt) || a.id.localeCompare(b.id));
  const at = new Date(now).toISOString();
  const current = ordered.find((session) => session.startAt <= at && at < session.endAt) ?? null;
  const upcoming = ordered.filter((session) => session.startAt > at);
  return { current, next: upcoming[0] ?? null, after: current ? (upcoming[0] ?? null) : (upcoming[1] ?? null) };
}

function upNext(
  session: ScreenAgendaSession | null,
  agenda: ScreenCachedAgenda,
  room: { id: string; name: string },
  now: number,
): LiveScheduleProjection {
  return {
    config: { ...DEFAULT_LIVE_SCHEDULE_CONFIG, scope: "this-room" },
    available: true,
    timeZone: agenda.timeZone,
    resolvedAt: new Date(now).toISOString(),
    rooms: session
      ? [
          {
            roomId: room.id,
            roomName: room.name,
            roomIndex: 0,
            occurrenceId: session.id,
            title: session.title,
            startAt: session.startAt,
            endAt: session.endAt,
            speakers: [],
          },
        ]
      : [],
  };
}

const countdown = (id: string, name: string, kind: LiveTimer["kind"], until: string): LiveTimer => ({
  id,
  name,
  kind,
  targetAt: kind === "until" ? until : null,
  durationSeconds: null,
  running: true,
  anchorAt: until,
  heldMs: 0,
  change: null,
});

/**
 * The stage display a screen runs on its own once the studio's session has
 * ended and the studio cannot be reached: the session under way counts to
 * its scheduled end; before the next one, the countdown to its start. Null
 * when the agenda holds nothing more for the room.
 */
export function screenAutoState(
  agenda: ScreenCachedAgenda,
  room: { id: string; name: string },
  now: number,
): LiveRoomState | null {
  const { current, next, after } = screenAgendaMoment(agenda.sessions, now);
  const shown = current ?? next;
  if (!shown) return null;
  const timer = current
    ? countdown(LIVE_SESSION_TIMER_ID, "Session", "session", current.endAt)
    : countdown(STARTS_IN_TIMER_ID, "Starts in", "until", shown.startAt);
  const graphic = current
    ? defaultLiveTimerGraphic(timer.id)
    : // A start coming up is no warning.
      { ...defaultLiveTimerGraphic(timer.id), warningSeconds: 0 };
  const stageDisplay = {
    ...EMPTY_LIVE_AUX_COMPOSITION,
    schedule: upNext(after, agenda, room, now),
    timerGraphics: [graphic],
  };
  const snapshot: LiveRoomSnapshot = {
    type: "room.snapshot",
    overlayLayouts: [],
    tickerContext: DEFAULT_LIVE_TICKER_CONTEXT,
    session: {
      occurrenceId: shown.id,
      title: shown.title,
      startAt: shown.startAt,
      endAt: shown.endAt,
      timeZone: agenda.timeZone,
      credits: [],
    },
    viewer: { role: "overlay", name: null },
    overlayMode: "direct",
    chat: [],
    questions: [],
    polls: [],
    stage: EMPTY_LIVE_AUX_COMPOSITION,
    outputs: { ...EMPTY_LIVE_OUTPUTS, "stage-display": stageDisplay },
    speakerMessage: null,
    preview: EMPTY_LIVE_AUX_COMPOSITION,
    timers: [timer],
    reactionTotals: {},
    queue: { question: [], "lower-third": [], poll: [], change: null },
    operators: [],
    addedCredits: [],
    stageDisplayNext: null,
  };
  return applyLiveRoomMessage(null, snapshot);
}
