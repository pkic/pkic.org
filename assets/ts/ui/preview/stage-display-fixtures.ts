/**
 * Synthetic rooms for the stage display specimens, one per state the speaker
 * meets: a talk with two timers, questions near the end, a poll, a break and
 * a session over time. Every one is drawn at the timer specimens' instant
 * (11:00 in Amsterdam), so the screenshots read the same.
 */
import { formFieldStatFromTallies } from "../../../shared/form-field-statistics";
import { DEFAULT_LIVE_POLL_PRESENTATION, type LivePoll } from "../../../shared/schemas/live-session-poll";
import { livePollFieldSchema } from "../../../shared/schemas/live-session-poll";
import {
  EMPTY_LIVE_AUX_COMPOSITION,
  EMPTY_LIVE_OUTPUTS,
  type LiveCredit,
  type LiveQuestion,
  type LiveStageQuestion,
  type LiveTimer,
} from "../../../shared/schemas/live-session-room";
import { liveScheduleProjectionSchema } from "../../../shared/schemas/live-session-schedule";
import { defaultLiveTimerGraphic, type LiveTimerGraphic } from "../../../shared/schemas/live-session-timer";
import { sessionLiveTimer } from "../../../shared/live-timer-policy";
import type { LiveRoomState } from "../../live-session/live-room-state";
import { TIMERS_FIXTURE_NOW, timersRoomState } from "./studio-timers-fixtures";

const MINUTE = 60_000;
const at = (ms: number) => new Date(TIMERS_FIXTURE_NOW + ms).toISOString();
const ROOM_ID = "30000000-0000-4000-8000-000000000001";
const sessionTimer = sessionLiveTimer();
const sessionGraphic = defaultLiveTimerGraphic(sessionTimer.id);

const credit = (key: string, name: string, organization: string | null = null): LiveCredit => ({
  key,
  name,
  moderator: false,
  photoUrl: null,
  identity: organization ? { title: null, organization } : null,
  roleLabel: null,
});

/** A session that runs from `startMs` to `endMs` around the specimens' instant. */
const session = (title: string, startMs: number, endMs: number, credits: LiveCredit[]) => ({
  occurrenceId: "30000000-0000-4000-8000-000000000031",
  title,
  startAt: at(startMs),
  endAt: at(endMs),
  timeZone: "Europe/Amsterdam",
  credits,
});

/** The session after this one in the room, as the agenda resolves it for the stage display. */
const upNext = liveScheduleProjectionSchema.parse({
  config: { scope: "this-room", layout: "list", theme: "white-on-black" },
  available: true,
  timeZone: "Europe/Amsterdam",
  resolvedAt: at(0),
  rooms: [
    {
      roomId: ROOM_ID,
      roomName: "Blue room",
      roomIndex: 0,
      occurrenceId: "30000000-0000-4000-8000-000000000032",
      title: "From inventory to migration: lessons from a national post-quantum transition program",
      startAt: at(20 * MINUTE),
      endAt: at(65 * MINUTE),
      speakers: [
        { name: "Jane Doe", moderator: false },
        { name: "John Roe", moderator: false },
      ],
    },
  ],
});

/** What the stage display shows, pinned by the operators: these timers, and the agenda's next session. */
const stageDisplay = (timerGraphics: LiveTimerGraphic[]) => ({
  ...EMPTY_LIVE_OUTPUTS,
  "stage-display": { ...EMPTY_LIVE_AUX_COMPOSITION, timerGraphics, schedule: upNext },
});

/** A talk: the session with 18:42 left, the pitch with 1:12 left (the large one), and applause arriving. */
const pitch: LiveTimer = {
  ...sessionTimer,
  id: "pitch",
  name: "Pitch",
  kind: "duration",
  followsAgenda: false,
  durationSeconds: 180,
  running: true,
  anchorAt: at(72_000),
};
export const stageTalkState: LiveRoomState = {
  ...timersRoomState([sessionTimer, pitch], [], {
    session: session(
      "Quantum-safe by 2030: what the EU roadmap means for every certificate you issue",
      -11 * MINUTE - 18_000,
      18 * MINUTE + 42_000,
      [credit("art", "Art de Blaauw", "Ministry of the Interior")],
    ),
    outputs: stageDisplay([
      sessionGraphic,
      { ...defaultLiveTimerGraphic(pitch.id), label: "Pitch 2 of 6", warningSeconds: 30 },
    ]),
  }),
  burst: { sequence: 1, counts: { applause: 24, love: 6 } },
};

const askedQuestion = (id: string, text: string, votes: number): LiveQuestion => ({
  id,
  text,
  status: "approved",
  votes,
  anonymous: false,
  authorName: "Riley Chen",
  authorPhotoUrl: null,
  mine: false,
  revision: 0,
  withdrawn: false,
  canEdit: false,
  votedByMe: false,
  askedAt: at(-10 * MINUTE),
  answeredAt: null,
  moderated: null,
  originalText: null,
  rewritten: null,
});
const onStage = (question: LiveQuestion): LiveStageQuestion => ({
  id: question.id,
  text: question.text,
  authorName: question.authorName,
  authorPhotoUrl: null,
  authorAffiliation: null,
});
const answering = askedQuestion(
  "20000000-0000-4000-8000-0000000000c1",
  "How will hybrid certificates affect chain validation in today's browsers?",
  44,
);
const lined = askedQuestion("20000000-0000-4000-8000-0000000000c2", "ML-DSA support in HSMs?", 31);

/** Questions near the end: 4:12 left, the operators' banner, one question on air and the next one lined up. */
export const stageQuestionsState: LiveRoomState = timersRoomState([sessionTimer], [], {
  session: session("Hybrid certificates in the browser", -25 * MINUTE, 4 * MINUTE + 12_000, [
    credit("sam", "Sam Speaker", "Example Bank"),
  ]),
  outputs: stageDisplay([sessionGraphic]),
  speakerMessage: { text: "Two minutes for questions", tone: "warning", flash: false, change: null },
  questions: [answering, lined],
  stage: { ...EMPTY_LIVE_AUX_COMPOSITION, question: onStage(answering) },
  stageDisplayNext: onStage(lined),
});

const pollField = livePollFieldSchema.parse({
  key: "answer",
  label: "When does your organization start its migration?",
  fieldType: "select",
  options: ["Already started", "Within 2 years", "Not planned"],
  validation: { uiWidget: "radios" },
});
const poll: LivePoll = {
  id: "20000000-0000-4000-8000-0000000000d1",
  field: pollField,
  status: "open",
  showResults: true,
  results: formFieldStatFromTallies(
    pollField,
    new Map([
      ["Already started", 124],
      ["Within 2 years", 62],
      ["Not planned", 28],
    ]),
    214,
  ),
  myAnswer: null,
  createdAt: at(-5 * MINUTE),
  change: null,
};

/** A panel with a poll on air: 11:30 left; five panelists only fit as surnames. */
export const stagePollState: LiveRoomState = timersRoomState([sessionTimer], [], {
  session: session(
    "Panel: are financial institutions ready for hybrid certificates in production?",
    -33 * MINUTE,
    11 * MINUTE + 30_000,
    [
      credit("p1", "Anna Jansen", "Example Bank"),
      credit("p2", "Wei Chen", "Sample Insurance"),
      credit("p3", "Priya Patel", "Demo Payments"),
      credit("p4", "Chidi Okafor", "Placeholder Clearing"),
      credit("p5", "Marta Silva", "Example Exchange"),
    ],
  ),
  outputs: stageDisplay([sessionGraphic]),
  polls: [poll],
  stage: { ...EMPTY_LIVE_AUX_COMPOSITION, poll: { id: poll.id, presentation: DEFAULT_LIVE_POLL_PRESENTATION } },
});

/** A coffee break: the next session starts in 11:57, and the operators' banner names the break. */
export const stageBreakState: LiveRoomState = timersRoomState([sessionTimer], [], {
  session: session(
    "From inventory to migration: lessons from a national post-quantum transition program",
    11 * MINUTE + 57_000,
    56 * MINUTE + 57_000,
    [credit("jane", "Jane Doe", "Ministry of the Interior"), credit("john", "John Roe", "Stedin")],
  ),
  outputs: stageDisplay([sessionGraphic]),
  speakerMessage: { text: "Coffee break", tone: "warning", flash: false, change: null },
});

/** A session over time by 2:14: the overtime takes the main area and the footer names what is next. */
export const stageOvertimeState: LiveRoomState = timersRoomState([sessionTimer], [], {
  session: session(
    "Quantum-safe by 2030: what the EU roadmap means for every certificate you issue",
    -32 * MINUTE,
    -2 * MINUTE - 14_000,
    [credit("art", "Art de Blaauw", "Ministry of the Interior")],
  ),
  outputs: stageDisplay([sessionGraphic]),
});
