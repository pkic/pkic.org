import { DEFAULT_LIVE_TICKER_CONTEXT } from "../../../assets/shared/schemas/live-session-ticker";
import {
  EMPTY_LIVE_AUX_COMPOSITION,
  EMPTY_LIVE_OUTPUTS,
  liveRoomClientMessageSchema,
  liveRoomServerMessageSchema,
  type LiveRoomClientMessage,
  type LiveRoomServerMessage,
  type LiveRoomSnapshot,
} from "../../../assets/shared/schemas/live-session-room";
import { livePollFieldSchema, type LivePoll } from "../../../assets/shared/schemas/live-session-poll";
import { formFieldStatFromTallies } from "../../../assets/shared/form-field-statistics";
import type { LiveSocketFactory } from "../../../assets/ts/live-session/useLiveRoom";
import type { LiveRoomState } from "../../../assets/ts/live-session/live-room-state";
import type { LiveTargets } from "../../../assets/ts/member-flows/portal/sections/events/detail/live/live-output-targets";

export const LIVE_POLL = "20000000-0000-4000-8000-000000000020";
/** The poll's question, as the forms field contract carries it. */
export const LIVE_POLL_FIELD = livePollFieldSchema.parse({
  key: "answer",
  label: "Which migration comes first?",
  fieldType: "select",
  options: ["Root CA", "TLS endpoints"],
  validation: { uiWidget: "radios" },
});

/** Running tallies per answer value, as the room charts them with the forms statistics. */
export function livePollResults(tallies: Record<string, number>) {
  const respondents = Object.values(tallies).reduce((sum, count) => sum + count, 0);
  return formFieldStatFromTallies(LIVE_POLL_FIELD, new Map(Object.entries(tallies)), respondents);
}

export function livePoll(overrides: Partial<LivePoll> = {}): LivePoll {
  return {
    id: LIVE_POLL,
    field: LIVE_POLL_FIELD,
    status: "open",
    showResults: true,
    results: null,
    myAnswer: null,
    createdAt: new Date(Date.now() - 120_000).toISOString(),
    change: null,
    ...overrides,
  };
}

/** A stand-in for the room's WebSocket: records what the page sends and delivers what the room would. */
export class FakeLiveSocket extends EventTarget {
  readyState = 0;
  readonly sent: string[] = [];
  constructor(
    readonly url: string,
    readonly protocols: string[],
  ) {
    super();
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
    this.dispatchEvent(new Event("close"));
  }
  /** The room accepted the handshake but refused admission, closing with the refusal's code. */
  refuse(code: number, reason: string) {
    this.readyState = 3;
    this.dispatchEvent(new CloseEvent("close", { code, reason }));
  }
  open() {
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
  }
  deliver(message: LiveRoomServerMessage) {
    const data = JSON.stringify(liveRoomServerMessageSchema.parse(message));
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
  /** Every contract message the page sent, parsed by the room's own schema. */
  messages(): LiveRoomClientMessage[] {
    return this.sent
      .filter((data) => data !== "ping")
      .map((data) => liveRoomClientMessageSchema.parse(JSON.parse(data)));
  }
}

export function fakeLiveSockets() {
  const sockets: FakeLiveSocket[] = [];
  const factory: LiveSocketFactory = (url, protocols) => {
    const socket = new FakeLiveSocket(url, protocols);
    sockets.push(socket);
    return socket as unknown as WebSocket;
  };
  return { sockets, factory, latest: () => sockets.at(-1)! };
}

export const LIVE_OCCURRENCE = "20000000-0000-4000-8000-000000000001";
export const LIVE_QUESTION = "20000000-0000-4000-8000-000000000002";

export function liveSnapshot(overrides: Partial<Omit<LiveRoomSnapshot, "type">> = {}): LiveRoomSnapshot {
  const now = Date.now();
  return {
    overlayLayouts: [],
    tickerContext: DEFAULT_LIVE_TICKER_CONTEXT,
    type: "room.snapshot",
    session: {
      occurrenceId: LIVE_OCCURRENCE,
      title: "Post-quantum migration",
      startAt: new Date(now - 10 * 60_000).toISOString(),
      endAt: new Date(now + 50 * 60_000).toISOString(),
      timeZone: "Europe/Amsterdam",
      credits: [
        {
          key: "user:speaker",
          name: "Sam Speaker",
          photoUrl: null,
          moderator: false,
          roleLabel: null,
          identity: { title: "Architect", organization: "Example" },
        },
      ],
    },
    viewer: { role: "attendee", name: "Ada Attendee" },
    overlayMode: "direct",
    chat: [],
    questions: [],
    polls: [],
    stage: {
      schedule: null,
      checkIn: null,
      panelists: null,
      ticker: null,
      question: null,
      questionChange: null,
      lowerThird: null,
      lowerThirdChange: null,
      lowerThirdMotion: "animated" as const,
      poll: null,
      pollChange: null,
      timerGraphics: [],
    },
    outputs: EMPTY_LIVE_OUTPUTS,
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
        heldMs: 50 * 60_000,
        change: null,
      },
    ],
    reactionTotals: {},
    queue: { question: [], "lower-third": [], poll: [], change: null },
    operators: [],
    addedCredits: [],
    stageDisplayNext: null,
    ...overrides,
  };
}

/** One shared ask time, so questions with equal votes order by id rather than by the millisecond each was built in. */
const LIVE_QUESTION_ASKED_AT = new Date(Date.now() - 60_000).toISOString();

export function liveQuestion(overrides: Record<string, unknown> = {}) {
  return {
    id: LIVE_QUESTION,
    text: "How do we inventory our certificates?",
    status: "approved" as const,
    votes: 2,
    anonymous: false,
    authorName: "Bea Attendee",
    authorPhotoUrl: null as string | null,
    mine: false,
    revision: 0,
    withdrawn: false,
    canEdit: false,
    votedByMe: false,
    askedAt: LIVE_QUESTION_ASKED_AT,
    answeredAt: null,
    moderated: null,
    originalText: null,
    rewritten: null,
    ...overrides,
  };
}

/** The control room's output controls over one room state; every destination answers as connected. */
export function liveTargets(state: LiveRoomState, overrides: Partial<LiveTargets> = {}): LiveTargets {
  return {
    state,
    programActive: true,
    disabled: false,
    sendProgram: () => true,
    ...overrides,
  };
}
