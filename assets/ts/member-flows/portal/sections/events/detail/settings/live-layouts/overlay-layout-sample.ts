import { DEFAULT_LIVE_STAGE_DISPLAY_SETTINGS } from "../../../../../../../../shared/schemas/live-stage-display-settings";
import {
  DEFAULT_LIVE_CHAT_FEED_CONFIG,
  DEFAULT_LIVE_TOP_QUESTIONS_CONFIG,
} from "../../../../../../../../shared/schemas/live-session-on-screen";
import { DEFAULT_LIVE_CHECK_IN_TEXT } from "../../../../../../../../shared/schemas/live-session-graphic-settings";
import { LIVE_MODERATOR_ROLE_LABEL } from "../../../../../../../../shared/live-room-credits";
import { formFieldStatFromTallies } from "../../../../../../../../shared/form-field-statistics";
import { LIVE_SESSION_TIMER_ID, sessionLiveTimer } from "../../../../../../../../shared/live-timer-policy";
import { livePollFieldSchema } from "../../../../../../../../shared/schemas/live-session-poll";
import {
  EMPTY_LIVE_AUX_COMPOSITION,
  EMPTY_LIVE_OUTPUTS,
} from "../../../../../../../../shared/schemas/live-session-room";
import { LIVE_GRAPHIC_THEME_DEFAULTS } from "../../../../../../../../shared/live-graphic-theme";
import { DEFAULT_LIVE_SCHEDULE_CONFIG } from "../../../../../../../../shared/schemas/live-session-schedule";
import { DEFAULT_LIVE_TICKER_CONTEXT } from "../../../../../../../../shared/schemas/live-session-ticker";
import { defaultLiveTimerGraphic } from "../../../../../../../../shared/schemas/live-session-timer";
import type { LiveRoomState } from "../../../../../../../live-session/live-room-state";

/**
 * A room with every graphic on air, so the layout editor's canvas shows each
 * element as the real overlay draws it. Placeholder people and text only;
 * nothing comes from the event.
 */

const SESSION = "00000000-0000-4000-8000-0000000000a1";
const QUESTION = "00000000-0000-4000-8000-0000000000a2";
const POLL = "00000000-0000-4000-8000-0000000000a3";
const ROOM = "00000000-0000-4000-8000-0000000000a4";
const NEXT = "00000000-0000-4000-8000-0000000000a5";

const POLL_FIELD = livePollFieldSchema.parse({
  key: "answer",
  label: "Which migration comes first?",
  fieldType: "select",
  options: ["Root CA", "TLS endpoints", "Code signing"],
  validation: { uiWidget: "radios" },
});

function credit(key: string, name: string, title: string, organization: string | null, moderator = false) {
  return {
    key,
    name,
    moderator,
    photoUrl: null,
    identity: { title, organization },
    roleLabel: moderator ? LIVE_MODERATOR_ROLE_LABEL : null,
  };
}

/** The sample, timed around `now` so its countdown and "up next" read naturally. */
export function sampleOverlayRoom(now: number): LiveRoomState {
  const at = (minutes: number) => new Date(now + minutes * 60_000).toISOString();
  const credits = [
    credit("sample:speaker", "Sam Speaker", "Principal architect", "Example Trust"),
    credit("sample:panelist", "Pat Panelist", "Head of PKI", "Example Bank"),
    credit("sample:moderator", "Morgan Moderator", "Program chair", null, true),
  ];
  const room: LiveRoomState = {
    session: {
      occurrenceId: SESSION,
      title: "Planning the post-quantum migration",
      startAt: at(-20),
      endAt: at(25),
      timeZone: "UTC",
      credits,
    },
    viewer: { role: "operator", name: "Sample operator" },
    questions: [],
    polls: [
      {
        id: POLL,
        field: POLL_FIELD,
        status: "open",
        showResults: true,
        results: formFieldStatFromTallies(
          POLL_FIELD,
          new Map([
            ["Root CA", 18],
            ["TLS endpoints", 31],
            ["Code signing", 9],
          ]),
          58,
        ),
        myAnswer: null,
        createdAt: at(-5),
        change: null,
      },
    ],
    overlayMode: "switcher",
    overlayLayouts: [],
    tickerContext: DEFAULT_LIVE_TICKER_CONTEXT,
    chat: [],
    stage: {
      question: {
        id: QUESTION,
        text: "How do we find every certificate we depend on?",
        authorName: null,
        authorPhotoUrl: null,
        authorAffiliation: null,
      },
      questionChange: null,
      lowerThird: credits[0]!,
      lowerThirdChange: null,
      lowerThirdMotion: "animated" as const,
      poll: { id: POLL, presentation: { chart: "bar" } },
      pollChange: null,
      ticker: {
        style: "gradient",
        messages: [{ id: "sample", prefix: "Next", template: "Sample", condition: "always" }],
        segments: [{ id: "sample", prefix: "Next", markdown: "Hybrid certificates in practice · Room B at 14:30" }],
      },
      panelists: { layout: "panel" },
      schedule: {
        config: DEFAULT_LIVE_SCHEDULE_CONFIG,
        available: true,
        timeZone: "UTC",
        resolvedAt: at(0),
        rooms: [
          {
            roomId: ROOM,
            roomName: "Main hall",
            roomIndex: 0,
            occurrenceId: NEXT,
            title: "Hybrid certificates in practice",
            startAt: at(30),
            endAt: at(75),
            speakers: [{ name: "Pat Panelist", moderator: false, photoUrl: null }],
          },
        ],
      },
      checkIn: {
        selection: { kind: "session", occurrenceId: SESSION },
        label: "Planning the post-quantum migration",
        path: "/portal/#/events/sample/check-in/sample",
        theme: LIVE_GRAPHIC_THEME_DEFAULTS.checkIn,
        text: DEFAULT_LIVE_CHECK_IN_TEXT,
      },
      timerGraphics: [
        { ...defaultLiveTimerGraphic(LIVE_SESSION_TIMER_ID), presentation: "digital", label: "Time left" },
      ],
      topQuestions: {
        config: DEFAULT_LIVE_TOP_QUESTIONS_CONFIG,
        questions: [
          { id: QUESTION, text: "How do we find every certificate we depend on?", authorName: null, votes: 12 },
          { id: NEXT, text: "Which algorithms should we pilot first?", authorName: "Riley Sample", votes: 7 },
        ],
      },
      chatFeed: {
        config: DEFAULT_LIVE_CHAT_FEED_CONFIG,
        messages: [
          { id: SESSION, authorName: "Alex Example", text: "Great overview of the inventory step." },
          { id: POLL, authorName: "Jordan Placeholder", text: "Will the slides be shared after the session?" },
        ],
      },
      reactions: true,
    },
    outputs: EMPTY_LIVE_OUTPUTS,
    speakerMessage: { text: "Please wrap up", tone: "warning", flash: false, change: null },
    preview: EMPTY_LIVE_AUX_COMPOSITION,
    timers: [{ ...sessionLiveTimer(), followsAgenda: false, heldMs: 12 * 60_000 + 30_000 }],
    reactionTotals: {},
    queue: { question: [], "lower-third": [], poll: [], change: null },
    operators: [],
    addedCredits: [],
    stageDisplayNext: null,
    stageDisplaySettings: DEFAULT_LIVE_STAGE_DISPLAY_SETTINGS,
    burst: null,
    refusal: null,
  };
  // The stage display shows the same room, so its elements have something to draw too.
  return { ...room, outputs: { ...EMPTY_LIVE_OUTPUTS, "stage-display": room.stage } };
}
