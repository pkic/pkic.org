// @vitest-environment jsdom
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, it } from "vitest";
import { LIVE_QUESTION, liveQuestion, liveSnapshot } from "./helpers/live-room-socket";
import {
  OPERATOR,
  button,
  commands,
  labeled,
  mountDesk,
  panel,
  resetDeskStorage,
  unmountDesks,
} from "./helpers/live-desk";

beforeEach(resetDeskStorage);
afterEach(unmountDesks);

/** A moderator without the studio: the whole desk in view, nothing on air in reach. */
function mountModeratorDesk(workspace = "show") {
  const pending = liveQuestion({ status: "pending", votes: 0 });
  return mountDesk(liveSnapshot({ viewer: OPERATOR, questions: [pending] }), workspace, undefined, false);
}

it("lets a moderator approve questions and create polls, with every on-air control off", () => {
  const { host, live } = mountModeratorDesk();
  const questions = panel(host, "Questions");
  expect(labeled(questions, "Approve").disabled).toBe(false);
  expect(labeled(questions, "Prepare question").disabled).toBe(false);
  expect(labeled(host, "New poll").disabled).toBe(false);
  // Lower thirds and the transition stay with the studio.
  expect(labeled(host, "Show Sam Speaker on air").disabled).toBe(true);
  expect(labeled(host, "Prepare Sam Speaker in Preview").disabled).toBe(true);
  expect(labeled(host, "Show Sam Speaker on air").dataset.tooltip).toBe(
    "Off air\nOnly the studio changes what Preview and Program show.",
  );
  expect(labeled(host, "Transition to Program").disabled).toBe(true);

  void act(() => labeled(questions, "Approve").click());
  void act(() => live.latest().deliver({ type: "question.changed", question: liveQuestion({}) }));
  // An approved question still goes on air only from the studio.
  expect(labeled(questions, "Show question on air").disabled).toBe(true);
  expect(commands(live)).toEqual([
    { type: "question.moderate", questionId: LIVE_QUESTION, expectedRevision: 0, status: "approved" },
  ]);
});

it("lets a moderator send the speaker a message", () => {
  const { host, live } = mountModeratorDesk("stage");
  const message = panel(host, "Message to speaker");
  void act(() => button(message, "Please wrap up").click());
  void act(() => button(message, "Send to stage").click());
  expect(commands(live)).toEqual([{ type: "speaker.message", text: "Please wrap up", tone: "warning", flash: false }]);
});
