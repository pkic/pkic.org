import { describe, expect, it } from "vitest";
import { LIVE_SESSION_TIMER_ID } from "../../assets/shared/live-timer-policy";
import { defaultLiveTimerGraphic } from "../../assets/shared/schemas/live-session-timer";
import { DEFAULT_LIVE_TOP_QUESTIONS_CONFIG } from "../../assets/shared/schemas/live-session-on-screen";
import { applyLiveRoomMessage, type LiveRoomState } from "../../assets/ts/live-session/live-room-state";
import { liveSceneThumbnailState } from "../../assets/ts/live-session/live-scene-thumbnail";
import { LIVE_POLL, liveSnapshot, livePoll, liveQuestion } from "./helpers/live-room-socket";

const QUESTION = {
  id: "20000000-0000-4000-8000-000000000031",
  text: "What about hybrid certificates?",
  authorName: null,
  authorPhotoUrl: null,
  authorAffiliation: null,
  addressedTo: null,
};
const TICKER = {
  style: "neutral" as const,
  messages: [{ id: "welcome", prefix: "", template: "Welcome to the PKI Consortium", condition: "always" as const }],
  segments: [],
};

function room(overrides: Parameters<typeof liveSnapshot>[0] = {}): LiveRoomState {
  return applyLiveRoomMessage(
    null,
    liveSnapshot({ viewer: { role: "operator", name: "Olga Operator" }, ...overrides }),
  )!;
}

/** The studio's Preview: the room with Preview's composition as its stage. */
const previewOf = (state: LiveRoomState): LiveRoomState => ({ ...state, stage: state.preview });

describe("scene thumbnails", () => {
  it("keeps every graphic Preview has, whatever Program shows", () => {
    const state = room({
      preview: { ...liveSnapshot().stage, question: QUESTION, ticker: TICKER },
      stage: { ...liveSnapshot().stage, question: { ...QUESTION, id: LIVE_POLL, text: "On air now" } },
    });
    const thumbnail = liveSceneThumbnailState(previewOf(state), state);
    expect(thumbnail.stage.question?.text).toBe("What about hybrid certificates?");
    expect(thumbnail.stage.ticker).toEqual(TICKER);
  });

  it("fills what Preview has empty from Program, then from the session's first credit and the open questions", () => {
    const state = room({
      questions: [
        liveQuestion({ id: "20000000-0000-4000-8000-000000000041", text: "Fewest votes", votes: 1 }),
        liveQuestion({ id: "20000000-0000-4000-8000-000000000042", text: "Most votes", votes: 9, anonymous: true }),
        liveQuestion({
          id: "20000000-0000-4000-8000-000000000043",
          text: "Not public yet",
          status: "pending",
          votes: 20,
        }),
        liveQuestion({ id: "20000000-0000-4000-8000-000000000044", text: "Taken back", withdrawn: true, votes: 30 }),
      ],
      polls: [livePoll()],
      stage: {
        ...liveSnapshot().stage,
        question: QUESTION,
        ticker: TICKER,
        poll: { id: LIVE_POLL, presentation: { chart: "bar" as const } },
        timerGraphics: [defaultLiveTimerGraphic(LIVE_SESSION_TIMER_ID)],
      },
    });
    const { stage } = liveSceneThumbnailState(previewOf(state), state);
    expect(stage.question?.text).toBe("What about hybrid certificates?");
    expect(stage.ticker).toEqual(TICKER);
    expect(stage.poll?.id).toBe(LIVE_POLL);
    expect(stage.timerGraphics.map((graphic) => graphic.timerId)).toEqual([LIVE_SESSION_TIMER_ID]);
    expect(stage.lowerThird?.name).toBe("Sam Speaker");
    expect(stage.topQuestions).toEqual({
      config: DEFAULT_LIVE_TOP_QUESTIONS_CONFIG,
      questions: [
        { id: "20000000-0000-4000-8000-000000000042", text: "Most votes", authorName: null, votes: 9 },
        { id: "20000000-0000-4000-8000-000000000041", text: "Fewest votes", authorName: "Bea Attendee", votes: 1 },
      ],
    });
  });

  it("leaves a graphic empty when the room has nothing real for it", () => {
    const state = room({ session: { ...liveSnapshot().session, credits: [] } });
    const { stage } = liveSceneThumbnailState(previewOf(state), null);
    expect(stage.lowerThird).toBeNull();
    expect(stage.topQuestions).toBeNull();
    expect(stage.question).toBeNull();
    expect(stage.ticker).toBeNull();
    expect(stage.checkIn).toBeNull();
    expect(stage.timerGraphics).toEqual([]);
  });

  it("takes from another session on air only what this room can draw", () => {
    const state = room();
    const other = room({
      timers: [],
      stage: {
        ...liveSnapshot().stage,
        poll: { id: LIVE_POLL, presentation: { chart: "bar" as const } },
        timerGraphics: [defaultLiveTimerGraphic("20000000-0000-4000-8000-000000000051")],
      },
    });
    const { stage } = liveSceneThumbnailState(previewOf(state), other);
    expect(stage.poll).toBeNull();
    expect(stage.timerGraphics).toEqual([]);
  });

  it("keeps a thumbnail still, without reaction bursts", () => {
    const state = { ...room(), burst: { sequence: 1, counts: { applause: 2 }, people: { applause: 2 } } };
    expect(liveSceneThumbnailState(previewOf(state), state).burst).toBeNull();
  });
});
