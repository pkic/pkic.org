// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { LIVE_ROOM_PROTOCOL, liveRoomClientMessageSchema } from "../../assets/shared/schemas/live-session-room";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";
import { SessionQuestions } from "../../assets/ts/live-session/SessionQuestions";
import {
  fakeLiveSockets,
  LIVE_OCCURRENCE,
  LIVE_POLL,
  LIVE_QUESTION,
  livePoll,
  livePollResults,
  liveQuestion,
  liveSnapshot,
} from "./helpers/live-room-socket";

const hosts: HTMLElement[] = [];

function mount(window = { startOffsetMinutes: -10, durationMinutes: 60 }) {
  const live = fakeLiveSockets();
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  const startAt = new Date(Date.now() + window.startOffsetMinutes * 60_000).toISOString();
  const endAt = new Date(Date.parse(startAt) + window.durationMinutes * 60_000).toISOString();
  void act(() => {
    render(
      <>
        <SessionQuestions
          slug="pqc-2026"
          occurrenceId={LIVE_OCCURRENCE}
          startAt={startAt}
          endAt={endAt}
          createSocket={live.factory}
        />
        <ConfirmDialogHost />
      </>,
      host,
    );
  });
  return { host, live };
}

function connect(live: ReturnType<typeof fakeLiveSockets>, snapshot = liveSnapshot()) {
  void act(() => {
    live.latest().open();
    live.latest().deliver(snapshot);
  });
}

function button(host: HTMLElement, name: string) {
  const found = [...host.querySelectorAll("button")].find(
    (candidate) => candidate.getAttribute("aria-label") === name || candidate.textContent?.trim() === name,
  );
  if (!found) throw new Error(`No button named ${name}`);
  return found;
}

function radio(host: HTMLElement, name: string) {
  const found = [...host.querySelectorAll<HTMLInputElement>("input[type=radio]")].find(
    (candidate) => candidate.closest("label")?.textContent?.trim() === name,
  );
  if (!found) throw new Error(`No choice named ${name}`);
  return found;
}

afterEach(() => {
  for (const host of hosts.splice(0)) {
    render(null, host);
    host.remove();
  }
});

describe("session questions", () => {
  it("stays out of the session details before the room opens", () => {
    const { host, live } = mount({ startOffsetMinutes: 120, durationMinutes: 30 });
    expect(host.textContent).toBe("");
    expect(live.sockets).toHaveLength(0);
  });

  it("joins the session's room over its own subprotocol", () => {
    const { live } = mount();
    expect(live.latest().url).toBe(
      `ws://${window.location.host}/api/v1/events/pqc-2026/agenda/occurrences/${LIVE_OCCURRENCE}/live`,
    );
    expect(live.latest().protocols).toEqual([LIVE_ROOM_PROTOCOL]);
  });

  it("asks through the shared contract, optionally anonymous", () => {
    const { host, live } = mount();
    connect(live);
    const text = host.querySelector<HTMLTextAreaElement>("textarea[name=text]")!;
    const anonymous = host.querySelector<HTMLInputElement>("input[name=anonymous]")!;
    void act(() => {
      text.value = "Which algorithms should we migrate first?";
      text.dispatchEvent(new Event("input", { bubbles: true }));
      anonymous.checked = true;
      anonymous.dispatchEvent(new Event("input", { bubbles: true }));
    });
    void act(() => {
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    const request = liveRoomClientMessageSchema.parse(live.latest().messages()[0]);
    expect(request).toMatchObject({
      type: "question.ask",
      text: "Which algorithms should we migrate first?",
      anonymous: true,
    });
    if (request.type !== "question.ask") throw new Error("Expected question request");
    expect(text.value).toBe(request.text);
    expect(text.disabled).toBe(true);
    void act(() => {
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(live.latest().messages()).toEqual([request, request]);
    void act(() =>
      live.latest().deliver({ type: "question.accepted", operationId: request.operationId, questionId: LIVE_QUESTION }),
    );
    expect(text.value).toBe("");
    expect(text.disabled).toBe(false);
  });

  it("retains a refused draft and ignores acknowledgments for another request", () => {
    const { host, live } = mount();
    connect(live);
    const text = host.querySelector<HTMLTextAreaElement>("textarea[name=text]")!;
    void act(() => {
      text.value = "Which certificates should we replace first?";
      text.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const submit = () => {
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    };
    void act(submit);
    const request = liveRoomClientMessageSchema.parse(live.latest().messages()[0]);
    if (request.type !== "question.ask") throw new Error("Expected question request");
    void act(() =>
      live.latest().deliver({ type: "question.accepted", operationId: crypto.randomUUID(), questionId: LIVE_QUESTION }),
    );
    expect(text.value).toBe(request.text);
    expect(text.disabled).toBe(true);
    void act(() =>
      live.latest().deliver({
        type: "room.refused",
        operationId: request.operationId,
        code: "LIVE_ROOM_RATE_LIMITED",
        message: "Please try again later.",
      }),
    );
    expect(text.value).toBe(request.text);
    expect(text.disabled).toBe(false);
    expect(host.textContent?.split("Please try again later.")).toHaveLength(2);
    void act(submit);
    const retried = liveRoomClientMessageSchema.parse(live.latest().messages()[1]);
    if (retried.type !== "question.ask") throw new Error("Expected question request");
    expect(retried.operationId).not.toBe(request.operationId);
  });

  it("lets an attendee post an answer and retains it until acknowledged", () => {
    const { host, live } = mount();
    connect(live, liveSnapshot({ questions: [liveQuestion()] }));
    void act(() => button(host, "Show answers").click());
    expect(live.latest().messages()).toContainEqual({ type: "question.answers.watch", questionId: LIVE_QUESTION });
    void act(() =>
      live.latest().deliver({
        type: "question.answers",
        questionId: LIVE_QUESTION,
        answers: [],
        canAnswer: true,
        canAccept: false,
      }),
    );
    const thread = host.querySelector<HTMLElement>('section[aria-label="Answers to this question"]')!;
    const text = thread.querySelector<HTMLTextAreaElement>("textarea")!;
    void act(() => {
      text.value = "Start with the public certificate inventory.";
      text.dispatchEvent(new Event("input", { bubbles: true }));
    });
    void act(() => {
      thread.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    const request = liveRoomClientMessageSchema.parse(live.latest().messages().at(-1));
    if (request.type !== "question.answer") throw new Error("Expected reply request");
    expect(request).toMatchObject({ questionId: LIVE_QUESTION, text: "Start with the public certificate inventory." });
    expect(text.value).toBe(request.text);
    expect(text.disabled).toBe(true);
    void act(() => button(thread, "Retry answer").click());
    expect(live.latest().messages().at(-1)).toEqual(request);
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
    expect([...thread.querySelectorAll("button")].some((item) => item.textContent === "Accept answer")).toBe(false);
  });

  it("uses server-granted acceptance rights and the current answer revision", () => {
    const { host, live } = mount();
    connect(live, liveSnapshot({ questions: [liveQuestion({ mine: true })] }));
    void act(() => button(host, "Show answers").click());
    const answer = {
      id: crypto.randomUUID(),
      text: "Prioritize the external certificate inventory.",
      authorName: "Other attendee",
      mine: false,
      createdAt: "2026-10-16T12:00:00.000Z",
      revision: 3,
      acceptance: null,
    };
    void act(() =>
      live.latest().deliver({
        type: "question.answers",
        questionId: LIVE_QUESTION,
        answers: [answer],
        canAnswer: true,
        canAccept: true,
      }),
    );
    void act(() => button(host, "Accept answer").click());
    const request = liveRoomClientMessageSchema.parse(live.latest().messages().at(-1));
    expect(request).toMatchObject({
      type: "question.answer.accept",
      questionId: LIVE_QUESTION,
      answerId: answer.id,
      expectedRevision: 3,
      accepted: true,
    });
    void act(() =>
      live.latest().deliver({
        type: "question.answers",
        questionId: LIVE_QUESTION,
        answers: [{ ...answer, revision: 4, acceptance: { byName: null, at: "2026-10-16T12:01:00.000Z" } }],
        canAnswer: true,
        canAccept: true,
      }),
    );
    if (request.type !== "question.answer.accept") throw new Error("Expected acceptance request");
    void act(() =>
      live.latest().deliver({
        type: "question.answer.result",
        operationId: request.operationId,
        questionId: LIVE_QUESTION,
        answerId: answer.id,
      }),
    );
    expect(host.textContent).toContain("Accepted by the question author");
    expect(button(host, "Remove acceptance").getAttribute("aria-pressed")).toBe("true");
  });

  it("edits through the reviewed revision and retains the dialog until its receipt", () => {
    const { host, live } = mount();
    connect(
      live,
      liveSnapshot({ questions: [liveQuestion({ mine: true, status: "pending", canEdit: true, revision: 2 })] }),
    );
    void act(() => button(host, "Your question actions").click());
    void act(() => button(host, "Edit question").click());
    const dialog = host.querySelector<HTMLElement>("dialog[open]")!;
    const text = dialog.querySelector<HTMLTextAreaElement>("textarea")!;
    void act(() => {
      text.value = "Should our inventory include internal endpoints?";
      text.dispatchEvent(new Event("input", { bubbles: true }));
    });
    void act(() => button(dialog, "Save changes").click());
    const request = liveRoomClientMessageSchema.parse(live.latest().messages().at(-1));
    if (request.type !== "question.edit") throw new Error("Expected author edit");
    expect(request).toMatchObject({ questionId: LIVE_QUESTION, expectedRevision: 2, text: text.value });
    expect(text.disabled).toBe(true);
    void act(() => button(dialog, "Retry changes").click());
    expect(live.latest().messages().at(-1)).toEqual(request);
    void act(() =>
      live.latest().deliver({
        type: "question.updated",
        operationId: crypto.randomUUID(),
        questionId: LIVE_QUESTION,
        revision: 3,
      }),
    );
    expect(host.querySelector("dialog[open]")).not.toBeNull();
    void act(() => {
      live.latest().deliver({
        type: "question.changed",
        question: liveQuestion({ mine: true, status: "pending", canEdit: true, revision: 3, text: request.text }),
      });
      live.latest().deliver({
        type: "question.updated",
        operationId: request.operationId,
        questionId: LIVE_QUESTION,
        revision: 3,
      });
    });
    expect(host.querySelector("dialog[open]")).toBeNull();
    expect(host.textContent).toContain(request.text);
  });

  it("keeps a refused author draft editable and honors server-provided editability", () => {
    const { host, live } = mount();
    connect(live, liveSnapshot({ questions: [liveQuestion({ mine: true, status: "pending", canEdit: true })] }));
    void act(() => button(host, "Your question actions").click());
    void act(() => button(host, "Edit question").click());
    const dialog = host.querySelector<HTMLElement>("dialog[open]")!;
    const text = dialog.querySelector<HTMLTextAreaElement>("textarea")!;
    void act(() => button(dialog, "Save changes").click());
    const request = liveRoomClientMessageSchema.parse(live.latest().messages().at(-1));
    if (request.type !== "question.edit") throw new Error("Expected author edit");
    void act(() =>
      live.latest().deliver({
        type: "room.refused",
        operationId: request.operationId,
        code: "LIVE_QUESTION_EDIT_CLOSED",
        message: "A moderator already reviewed this question.",
      }),
    );
    expect(text.value).toBe(request.text);
    expect(text.disabled).toBe(false);
    expect(dialog.textContent).toContain("A moderator already reviewed this question.");
    void act(() => button(dialog, "Cancel").click());
    void act(() =>
      live.latest().deliver({ type: "question.changed", question: liveQuestion({ mine: true, canEdit: false }) }),
    );
    void act(() => button(host, "Your question actions").click());
    expect(button(host, "Edit question").disabled).toBe(true);
  });

  it("confirms withdrawal and retries the same request until acknowledged", async () => {
    const { host, live } = mount();
    connect(live, liveSnapshot({ questions: [liveQuestion({ mine: true })] }));
    void act(() => button(host, "Your question actions").click());
    void act(() => button(host, "Withdraw question").click());
    expect(live.latest().messages()).toEqual([]);
    const confirm = host.querySelector<HTMLElement>("dialog[open]")!;
    await act(async () => {
      button(confirm, "Withdraw question").click();
    });
    const request = liveRoomClientMessageSchema.parse(live.latest().messages().at(-1));
    if (request.type !== "question.withdraw") throw new Error("Expected withdrawal");
    expect(request).toMatchObject({ questionId: LIVE_QUESTION, expectedRevision: 0 });
    void act(() =>
      live.latest().deliver({
        type: "question.changed",
        question: liveQuestion({ mine: true, status: "hidden", withdrawn: true, revision: 1 }),
      }),
    );
    void act(() => button(host, "Retry withdrawal").click());
    expect(live.latest().messages().at(-1)).toEqual(request);
    void act(() =>
      live.latest().deliver({
        type: "question.updated",
        operationId: request.operationId,
        questionId: LIVE_QUESTION,
        revision: 1,
      }),
    );
    expect(host.textContent).toContain("Withdrawn");
    expect(
      [...host.querySelectorAll("button")].some((item) => item.getAttribute("aria-label") === "Your question actions"),
    ).toBe(false);
  });

  it("cancels withdrawal without sending a mutation", async () => {
    const { host, live } = mount();
    connect(live, liveSnapshot({ questions: [liveQuestion({ mine: true })] }));
    void act(() => button(host, "Your question actions").click());
    void act(() => button(host, "Withdraw question").click());
    const confirm = host.querySelector<HTMLElement>("dialog[open]")!;
    await act(async () => {
      button(confirm, "Cancel").click();
    });
    expect(live.latest().messages()).toEqual([]);
  });

  it("waits for a question the contract accepts and says why on the status line", () => {
    const { host, live } = mount();
    connect(live);
    void act(() => {
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(live.latest().messages()).toEqual([]);
    // An empty question is at rest, not an error.
    expect(host.querySelector("[aria-invalid=true]")).toBeNull();
    expect(button(host, "Ask").disabled).toBe(true);
    const text = host.querySelector("textarea")!;
    void act(() => {
      text.value = "ab";
      text.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(text.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(text.getAttribute("aria-describedby")!)?.textContent).toContain("a few characters");
    expect(button(host, "Ask").disabled).toBe(true);
  });

  it("shows a named asker's photo and capacity beside their question, and none for an anonymous one", () => {
    const { host, live } = mount();
    const photo = "/api/v1/users/u1/headshots/portrait.jpg";
    connect(
      live,
      liveSnapshot({
        questions: [
          liveQuestion({ authorPhotoUrl: photo, authorAffiliation: { organization: { name: "Digitorus" } } }),
          liveQuestion({
            id: "20000000-0000-4000-8000-000000000003",
            anonymous: true,
            authorName: null,
            authorPhotoUrl: null,
          }),
        ],
      }),
    );
    const [named, anonymous] = [...host.querySelectorAll(".pk-live-question")];
    expect(named.querySelector(".pk-avatar img")).not.toBeNull();
    expect(named.querySelector(".pk-live-author__capacity")?.textContent).toBe("Digitorus");
    expect(anonymous.querySelector(".pk-avatar")).toBeNull();
    expect(anonymous.textContent).toContain("Anonymous");
  });

  it("votes and withdraws a vote without unrelated reaction controls", () => {
    const { host, live } = mount();
    connect(live, liveSnapshot({ questions: [liveQuestion()] }));
    void act(() => button(host, "Vote: 2 votes").click());
    void act(() => button(host, "Vote: 2 votes").click());
    expect(button(host, "Vote: 2 votes").getAttribute("aria-pressed")).toBe("false");
    void act(() =>
      live.latest().deliver({ type: "question.changed", question: liveQuestion({ votes: 3, votedByMe: true }) }),
    );
    expect(button(host, "Remove your vote: 3 votes").getAttribute("aria-pressed")).toBe("true");
    void act(() => button(host, "Remove your vote: 3 votes").click());
    void act(() => button(host, "Remove your vote: 3 votes").click());
    expect(host.querySelector('[aria-label="Reactions"]')).toBeNull();
    expect(live.latest().messages()).toEqual([
      { type: "question.vote", questionId: LIVE_QUESTION, voted: true },
      { type: "question.vote", questionId: LIVE_QUESTION, voted: true },
      { type: "question.vote", questionId: LIVE_QUESTION, voted: false },
      { type: "question.vote", questionId: LIVE_QUESTION, voted: false },
    ]);
    void act(() =>
      live.latest().deliver({ type: "question.changed", question: liveQuestion({ votes: 2, votedByMe: false }) }),
    );
    expect(button(host, "Vote: 2 votes").getAttribute("aria-pressed")).toBe("false");
  });

  it.each(["pending", "answered", "hidden"] as const)("does not offer upvoting for a %s question", (status) => {
    const { host, live } = mount();
    connect(live, liveSnapshot({ questions: [liveQuestion({ status, mine: true })] }));
    expect(button(host, "Vote: 2 votes").disabled).toBe(true);
  });

  it("shows the author their own question awaiting moderation and others' anonymous questions without a name", () => {
    const { host, live } = mount();
    connect(
      live,
      liveSnapshot({
        questions: [
          liveQuestion({
            id: "20000000-0000-4000-8000-000000000010",
            status: "pending",
            mine: true,
            votes: 0,
            authorName: "Ada Attendee",
          }),
          liveQuestion({ anonymous: true, authorName: null }),
        ],
      }),
    );
    expect(host.textContent).toContain("Awaiting moderation");
    expect(host.textContent).toContain("Anonymous");
    expect(host.textContent).not.toContain("Bea Attendee");
  });

  it("lets a credited speaker mark an open question answered", () => {
    const { host, live } = mount();
    connect(live, liveSnapshot({ viewer: { role: "speaker", name: "Sam Speaker" }, questions: [liveQuestion()] }));
    void act(() => button(host, "Mark answered").click());
    expect(live.latest().messages()).toEqual([
      { type: "question.moderate", questionId: LIVE_QUESTION, expectedRevision: 0, status: "answered" },
    ]);
  });

  it("answers the open poll with the form controls, changeably, and shows the results it is allowed to see", () => {
    const { host, live } = mount();
    connect(live, liveSnapshot({ polls: [livePoll()] }));
    expect(host.textContent).toContain("Which migration comes first?");
    expect(host.querySelector(".pk-chart__bars")).toBeNull();
    // Sending nothing is refused by the forms answer rules, on the question, before the room hears of it.
    void act(() => button(host, "Send answer").click());
    expect(host.querySelector("[data-field-error=answer]")?.textContent).toMatch(/required/);
    void act(() => radio(host, "TLS endpoints").click());
    void act(() => button(host, "Send answer").click());
    void act(() =>
      live.latest().deliver({
        type: "poll.changed",
        poll: livePoll({ myAnswer: "TLS endpoints", results: livePollResults({ "Root CA": 1, "TLS endpoints": 3 }) }),
      }),
    );
    expect(radio(host, "TLS endpoints").checked).toBe(true);
    expect(host.querySelector(".pk-chart__bars")?.textContent).toContain("3 · 75%");
    void act(() => radio(host, "Root CA").click());
    void act(() => button(host, "Change answer").click());
    const votes = live.latest().messages();
    expect(votes.map((message) => liveRoomClientMessageSchema.parse(message))).toEqual([
      { type: "poll.vote", pollId: LIVE_POLL, answer: "TLS endpoints" },
      { type: "poll.vote", pollId: LIVE_POLL, answer: "Root CA" },
    ]);
  });

  it("marks an answer the room refused on the question, and only there", () => {
    const { host, live } = mount();
    connect(live, liveSnapshot({ polls: [livePoll()] }));
    void act(() =>
      live.latest().deliver({ type: "room.refused", code: "LIVE_POLL_ANSWER", message: "Pick one of the choices." }),
    );
    expect(host.querySelector("[data-field-error=answer]")?.textContent).toContain("Pick one of the choices.");
    // Said once, on the question: the room's general notice stays quiet.
    expect(host.querySelector(".pk-live-questions__notice")?.textContent).toBe("");
  });

  it("shows a closed poll's results without asking for an answer", () => {
    const { host, live } = mount();
    const closed = livePoll({ status: "closed", results: livePollResults({ "Root CA": 2 }) });
    connect(live, liveSnapshot({ polls: [closed] }));
    expect(host.textContent).toContain("Poll results");
    expect(host.querySelector("input[type=radio]")).toBeNull();
    expect(host.querySelector(".pk-chart__bars")?.textContent).toContain("2 · 100%");
  });

  it("keeps the last state read-only while the room reconnects", () => {
    const { host, live } = mount();
    connect(live, liveSnapshot({ questions: [liveQuestion()] }));
    void act(() => live.latest().close());
    expect(host.textContent).toContain("Live updates are paused");
    expect(host.textContent).toContain("How do we inventory our certificates?");

    expect(button(host, "Vote: 2 votes").disabled).toBe(true);
  });

  it.each([
    [4403, "LIVE_SESSION_ACCESS_REQUIRED", "Questions are open to registered attendees with access to this session."],
    [4401, "AUTH_EXPIRED", "Your sign-in has ended. Sign in again to ask and vote."],
    [4404, "LIVE_SESSION_NOT_FOUND", "This session doesn't take live questions yet."],
  ])("says why the room refused an attendee (%i %s), not that questions are unavailable", (code, reason, copy) => {
    const { host, live } = mount();
    void act(() => live.latest().refuse(code, reason));
    expect(host.querySelector(".pk-alert")?.textContent).toBe(copy);
    expect(live.sockets).toHaveLength(1);
  });

  it("says when the room cannot be reached at all", () => {
    const { host, live } = mount();
    void act(() => live.latest().close());
    expect(host.querySelector(".pk-alert")?.textContent).toBe(
      "Questions can't be reached right now. Check your connection, then reload the page.",
    );
  });
});
