/**
 * Synthetic data for the event screen specimens: one room on a fixed
 * morning, so every screenshot reads the same.
 */
import { DEFAULT_LIVE_TICKER_CONTEXT } from "../../../shared/schemas/live-session-ticker";
import {
  EMPTY_LIVE_AUX_COMPOSITION,
  EMPTY_LIVE_OUTPUTS,
  type LiveRoomSnapshot,
} from "../../../shared/schemas/live-session-room";
import { liveScheduleProjectionSchema } from "../../../shared/schemas/live-session-schedule";
import { defaultLiveTimerGraphic } from "../../../shared/schemas/live-session-timer";
import { applyLiveRoomMessage, type LiveRoomState } from "../../live-session/live-room-state";

export const SCREEN_FIXTURE = {
  screenId: "K7M2QA",
  pairingCode: "HJKP4QRT",
  name: "Foyer, by registration",
  roomId: "room-blue",
  roomName: "Blue room",
  timeZone: "Europe/Amsterdam",
} as const;

/** What comes next in the room, as the approved public agenda resolves it. */
const screenScheduleFixture = liveScheduleProjectionSchema.parse({
  config: { scope: "this-room", layout: "list", theme: "white-on-black" },
  available: true,
  timeZone: SCREEN_FIXTURE.timeZone,
  resolvedAt: "2026-12-01T09:18:00.000Z",
  rooms: [
    {
      roomId: SCREEN_FIXTURE.roomId,
      roomName: SCREEN_FIXTURE.roomName,
      roomIndex: 1,
      occurrenceId: "occurrence-next",
      title: "Migrating a private CA to post-quantum algorithms",
      startAt: "2026-12-01T09:30:00.000Z",
      endAt: "2026-12-01T10:15:00.000Z",
      speakers: [
        { name: "Alex Example", moderator: false },
        { name: "Riley Sample", moderator: false },
        { name: "Jordan Placeholder", moderator: true },
      ],
    },
  ],
});

const AFTER_NEXT = liveScheduleProjectionSchema.parse({
  ...screenScheduleFixture,
  resolvedAt: "2026-12-01T09:26:00.000Z",
  rooms: [
    {
      ...screenScheduleFixture.rooms[0]!,
      occurrenceId: "occurrence-after",
      title: "Crypto agility in hardware security modules",
      startAt: "2026-12-01T10:30:00.000Z",
      endAt: "2026-12-01T11:15:00.000Z",
      speakers: [{ name: "Casey Demo", moderator: false }],
    },
  ],
});

type StageSession = { occurrenceId: string; title: string; startAt: string; endAt: string };

/**
 * A room as its stage display shows it: the session the studio selected, its
 * session timer paused at `heldMs` so the specimen holds one reading, and the
 * room's Up next.
 */
function stageDisplayState(
  session: StageSession,
  heldMs: number,
  schedule: typeof screenScheduleFixture,
): LiveRoomState {
  const stageDisplay = {
    ...EMPTY_LIVE_AUX_COMPOSITION,
    schedule,
    timerGraphics: [defaultLiveTimerGraphic("session")],
  };
  const snapshot: LiveRoomSnapshot = {
    type: "room.snapshot",
    overlayLayouts: [],
    tickerContext: DEFAULT_LIVE_TICKER_CONTEXT,
    session: { ...session, timeZone: SCREEN_FIXTURE.timeZone, credits: [] },
    viewer: { role: "attendee", name: "Stage display" },
    overlayMode: "direct",
    chat: [],
    questions: [],
    polls: [],
    stage: EMPTY_LIVE_AUX_COMPOSITION,
    // The stage display draws its own composition: the session timer and the room's Up next.
    outputs: { ...EMPTY_LIVE_OUTPUTS, "stage-display": stageDisplay },
    speakerMessage: null,
    preview: EMPTY_LIVE_AUX_COMPOSITION,
    timers: [
      {
        id: "session",
        name: "Session",
        kind: "session",
        targetAt: null,
        durationSeconds: null,
        running: false,
        anchorAt: null,
        heldMs,
        change: null,
      },
    ],
    reactionTotals: {},
    queue: { question: [], "lower-third": [], poll: [], change: null },
    operators: [],
    addedCredits: [],
    stageDisplayNext: null,
  };
  return applyLiveRoomMessage(null, snapshot)!;
}

/** A session under way, as the screen keeps showing it after the connection drops. */
export const screenStageRunningFixture = stageDisplayState(
  {
    occurrenceId: "occurrence-now",
    title: "Certificate lifecycle automation at scale",
    startAt: "2026-12-01T08:45:00.000Z",
    endAt: "2026-12-01T09:25:00.000Z",
  },
  23 * 60_000 + 41_000,
  screenScheduleFixture,
);

/** Ready for the next speaker: the studio selected the next session and its timer waits at full length. */
export const screenStageReadyFixture = stageDisplayState(
  {
    occurrenceId: screenScheduleFixture.rooms[0]!.occurrenceId,
    title: screenScheduleFixture.rooms[0]!.title,
    startAt: screenScheduleFixture.rooms[0]!.startAt,
    endAt: screenScheduleFixture.rooms[0]!.endAt,
  },
  45 * 60_000,
  AFTER_NEXT,
);
