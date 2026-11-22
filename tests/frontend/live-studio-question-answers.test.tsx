// @vitest-environment jsdom
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveQuestionAnswer } from "../../assets/shared/schemas/live-session-answer";
import { LIVE_QUESTION, liveQuestion, liveSnapshot } from "./helpers/live-room-socket";
import {
  OPERATOR,
  button,
  commands,
  labeled,
  mountDesk,
  panel,
  resetDeskStorage,
  type,
  unmountDesks,
} from "./helpers/live-desk";

beforeEach(resetDeskStorage);
afterEach(unmountDesks);

function answer(overrides: Partial<LiveQuestionAnswer> = {}): LiveQuestionAnswer {
  return {
    id: crypto.randomUUID(),
    text: "Automate renewal first.",
    authorName: "Alex Moreau",
    mine: false,
    createdAt: "2026-10-16T12:00:00.000Z",
    revision: 0,
    acceptance: null,
    votes: 0,
    votedByMe: false,
    removal: null,
    authorRestriction: null,
    authorStaff: false,
    ...overrides,
  };
}

type Desk = ReturnType<typeof mountDesk>;

/** The room's answer to watching a question: its thread with a moderator's rights. */
function deliverThread(live: Desk["live"], answers: LiveQuestionAnswer[]) {
  void act(() =>
    live.latest().deliver({
      type: "question.answers",
      questionId: LIVE_QUESTION,
      answers,
      canAnswer: true,
      canAccept: true,
      canVote: true,
      canModerate: true,
    }),
  );
}

/** Opens the studio's first question from its row and returns the dialog. */
function openQuestion(host: HTMLElement): HTMLElement {
  void act(() => panel(host, "Questions").querySelector<HTMLButtonElement>(".pk-studio-row__open")!.click());
  const dialog = document.querySelector<HTMLElement>("dialog[open]");
  if (!dialog) throw new Error("The question did not open");
  return dialog;
}

const summary = (host: HTMLElement) =>
  panel(host, "Questions").querySelector(".pk-studio-row__summary")?.textContent ?? "";

describe("answers in the studio", () => {
  it("says on a question's row how many answers it has and that one is accepted, and nothing without answers", () => {
    const { host, live } = mountDesk(liveSnapshot({ viewer: OPERATOR, questions: [liveQuestion()] }));
    expect(summary(host)).not.toContain("answer");
    void act(() => live.latest().deliver({ type: "question.changed", question: liveQuestion({ answerCount: 1 }) }));
    expect(summary(host)).toContain("1 answer");
    expect(summary(host)).not.toContain("accepted");
    void act(() =>
      live
        .latest()
        .deliver({ type: "question.changed", question: liveQuestion({ answerCount: 2, acceptedAnswer: true }) }),
    );
    expect(summary(host)).toContain("2 answers");
    expect(summary(host)).toContain("1 accepted");
    // A count is plain text in the summary line, never a pill.
    expect(panel(host, "Questions").querySelector(".pk-studio-row .pk-badge")).toBeNull();
  });

  it("opens a question on its answers, without a toggle, and stops following them when it closes", () => {
    const { host, live } = mountDesk(liveSnapshot({ viewer: OPERATOR, questions: [liveQuestion({ answerCount: 1 })] }));
    const dialog = openQuestion(host);
    expect(commands(live)).toEqual([{ type: "question.answers.watch", questionId: LIVE_QUESTION }]);
    // The thread's own loading state stands until the room answers.
    expect(dialog.querySelector('section[aria-label="Answers to this question"]')?.textContent).toContain(
      "Loading answers",
    );
    deliverThread(live, [answer()]);
    expect(dialog.textContent).toContain("Automate renewal first.");
    expect(dialog.textContent).toContain("Alex Moreau");
    expect([...dialog.querySelectorAll("button")].map((item) => item.textContent?.trim())).not.toContain(
      "Hide answers",
    );
    // The open question follows the room: a new answer's count shows without reopening.
    void act(() => live.latest().deliver({ type: "question.changed", question: liveQuestion({ answerCount: 2 }) }));
    expect(dialog.querySelector(".pk-live-answers__summary")?.textContent).toContain("2 answers");
    void act(() => labeled(dialog, "Close question").click());
    expect(document.querySelector("dialog[open]")).toBeNull();
    expect(commands(live).at(-1)).toEqual({ type: "question.answers.watch", questionId: null });
  });

  it("follows the open question's answers again after the room reconnects, and its box rests meanwhile", () => {
    const snapshot = liveSnapshot({ viewer: OPERATOR, questions: [liveQuestion()] });
    const { host, live } = mountDesk(snapshot);
    const dialog = openQuestion(host);
    deliverThread(live, []);
    vi.useFakeTimers();
    try {
      void act(() => live.latest().close());
      expect(dialog.querySelector<HTMLTextAreaElement>("textarea[name=text]")!.disabled).toBe(true);
      void act(() => void vi.advanceTimersByTime(1_000));
    } finally {
      vi.useRealTimers();
    }
    expect(live.sockets).toHaveLength(2);
    void act(() => {
      live.latest().open();
      live.latest().deliver(snapshot);
    });
    expect(commands(live)).toEqual([{ type: "question.answers.watch", questionId: LIVE_QUESTION }]);
    expect(dialog.querySelector('section[aria-label="Answers to this question"]')?.textContent).toContain(
      "Loading answers",
    );
  });

  it("tells the other operators where this one is, not that reading a question's answers changed anything", async () => {
    const { host, live } = mountDesk(liveSnapshot({ viewer: OPERATOR, questions: [liveQuestion()] }));
    const row = panel(host, "Questions").querySelector<HTMLButtonElement>(".pk-studio-row__open")!;
    void act(() => void row.dispatchEvent(new MouseEvent("pointerover", { bubbles: true })));
    openQuestion(host);
    await act(() => new Promise((resolve) => setTimeout(resolve, 150)));
    const presence = live
      .latest()
      .messages()
      .filter((message) => message.type === "presence.update");
    expect(presence.length).toBeGreaterThan(0);
    expect(presence.filter((message) => message.changed)).toEqual([]);
  });

  it("posts an operator's answer through the answer contract and clears the box on the room's receipt", () => {
    const { host, live } = mountDesk(liveSnapshot({ viewer: OPERATOR, questions: [liveQuestion()] }));
    const dialog = openQuestion(host);
    deliverThread(live, []);
    expect(dialog.textContent).toContain("No answers yet. Add the first answer.");
    const text = dialog.querySelector<HTMLTextAreaElement>("textarea[name=text]")!;
    type(text, "The speaker covers this in the last ten minutes.");
    void act(() => button(dialog, "Post answer").click());
    // `commands` reads what was sent through the room's own client message schema.
    const request = commands(live).at(-1)!;
    if (request.type !== "question.answer") throw new Error("Expected an answer");
    expect(request).toMatchObject({
      questionId: LIVE_QUESTION,
      text: "The speaker covers this in the last ten minutes.",
    });
    expect(text.disabled).toBe(true);
    void act(() =>
      live.latest().deliver({
        type: "question.answer.result",
        operationId: request.operationId,
        questionId: LIVE_QUESTION,
        answerId: crypto.randomUUID(),
      }),
    );
    expect(text.value).toBe("");
    expect(text.disabled).toBe(false);
  });

  it("accepts an answer on its current revision, with a hint that names the control and what it does", async () => {
    const { host, live } = mountDesk(liveSnapshot({ viewer: OPERATOR, questions: [liveQuestion()] }));
    const dialog = openQuestion(host);
    const given = answer({ revision: 3 });
    deliverThread(live, [given]);
    // The tooltip layer takes a new control's title as soon as the page has settled.
    await act(async () => undefined);
    const accept = labeled(dialog, "Accept answer");
    // The studio's tooltip layer takes the title; an operator did not ask the question, so it is not "yours".
    expect(accept.hasAttribute("title")).toBe(false);
    expect(accept.dataset.tooltip).toBe(
      "Accept answer\nMarks this as the answer to this question. Everyone sees it first.",
    );
    void act(() => accept.click());
    const request = commands(live).at(-1)!;
    if (request.type !== "question.answer.accept") throw new Error("Expected an acceptance");
    expect(request).toMatchObject({
      questionId: LIVE_QUESTION,
      answerId: given.id,
      expectedRevision: 3,
      accepted: true,
    });
  });

  it("says a refused answer in the thread, keeps the draft, and leaves the session bar alone", () => {
    const { host, live } = mountDesk(liveSnapshot({ viewer: OPERATOR, questions: [liveQuestion()] }));
    const dialog = openQuestion(host);
    deliverThread(live, []);
    const text = dialog.querySelector<HTMLTextAreaElement>("textarea[name=text]")!;
    type(text, "See the migration guide.");
    void act(() => button(dialog, "Post answer").click());
    const request = commands(live).at(-1)!;
    if (request.type !== "question.answer") throw new Error("Expected an answer");
    void act(() =>
      live.latest().deliver({
        type: "room.refused",
        code: "LIVE_ANSWERS_FULL",
        message: "This question is not taking more replies.",
        operationId: request.operationId,
      }),
    );
    expect(dialog.querySelector('section[aria-label="Answers to this question"]')?.textContent).toContain(
      "This question is not taking more replies.",
    );
    expect(text.value).toBe("See the migration guide.");
    expect(host.querySelector(".pk-studio__bar")?.textContent).not.toContain("not taking more replies");
  });
});
