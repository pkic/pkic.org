// @vitest-environment jsdom
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { liveRoomClientMessageSchema } from "../../assets/shared/schemas/live-session-room";
import {
  liveQuestionPlace,
  liveQuestionsIn,
} from "../../assets/ts/member-flows/portal/sections/events/detail/live/live-question-places";
import {
  OPERATOR,
  commands,
  labeled,
  menuItem,
  mountDesk,
  panel,
  resetDeskStorage,
  unmountDesks,
} from "./helpers/live-desk";
import { LIVE_QUESTION, liveQuestion, liveSnapshot } from "./helpers/live-room-socket";

beforeEach(resetDeskStorage);
afterEach(unmountDesks);

const DONE = { operatorName: "Olga Operator", at: "2026-12-01T09:18:00.000Z" };

describe("a question's place in the studio", () => {
  it("is open until it is discussed, ignored or hidden, and nowhere once its author withdrew a closed one", () => {
    expect(liveQuestionPlace(liveQuestion({ status: "pending" }))).toBe("open");
    expect(liveQuestionPlace(liveQuestion())).toBe("open");
    expect(liveQuestionPlace(liveQuestion({ done: DONE }))).toBe("ignored");
    // What happened to a question on stage or in moderation says more than that it was set aside before.
    expect(liveQuestionPlace(liveQuestion({ status: "answered", done: DONE }))).toBe("discussed");
    expect(liveQuestionPlace(liveQuestion({ status: "hidden", done: DONE }))).toBe("hidden");
    expect(liveQuestionPlace(liveQuestion({ status: "hidden", withdrawn: true }))).toBeNull();
    expect(liveQuestionsIn([liveQuestion(), liveQuestion({ done: DONE })], "open")).toHaveLength(1);
  });
});

describe("ignoring a question in the studio", () => {
  it("takes it off the open ones without hiding it, and brings it back from the Ignored tab", async () => {
    const { host, live } = mountDesk(liveSnapshot({ viewer: OPERATOR, questions: [liveQuestion()] }));
    const questions = panel(host, "Questions");
    expect(questions.textContent).toContain("1 open");
    await act(async () => labeled(questions, "Question actions").click());
    await act(async () => menuItem(document, "Ignore").click());
    // The room's own Done, which leaves the question as it is for attendees.
    expect(liveRoomClientMessageSchema.parse(commands(live).at(-1))).toEqual({
      type: "moderation.done",
      item: { kind: "question", questionId: LIVE_QUESTION },
      done: true,
    });
    void act(() => live.latest().deliver({ type: "question.changed", question: liveQuestion({ done: DONE }) }));
    expect(questions.textContent).toContain("0 open");
    expect(questions.querySelector("#studio-questions-ignored")?.textContent).toBe("Ignored · 1");
    void act(() => labeled(questions, "Back to Open").click());
    expect(liveRoomClientMessageSchema.parse(commands(live).at(-1))).toEqual({
      type: "moderation.done",
      item: { kind: "question", questionId: LIVE_QUESTION },
      done: false,
    });
  });
});
