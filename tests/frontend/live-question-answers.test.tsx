// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import type { LiveQuestionAnswer } from "../../assets/shared/schemas/live-session-answer";
import type { LiveRoomSnapshot } from "../../assets/shared/schemas/live-session-room";
import { SessionQuestions } from "../../assets/ts/live-session/SessionQuestions";
import {
  fakeLiveSockets,
  LIVE_OCCURRENCE,
  LIVE_QUESTION,
  liveQuestion,
  liveSnapshot,
} from "./helpers/live-room-socket";

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) {
    render(null, host);
    host.remove();
  }
});

function mount(snapshot: LiveRoomSnapshot) {
  const live = fakeLiveSockets();
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  const startAt = new Date(Date.now() - 10 * 60_000).toISOString();
  const endAt = new Date(Date.now() + 50 * 60_000).toISOString();
  void act(() =>
    render(
      <SessionQuestions
        slug="pqc-2026"
        occurrenceId={LIVE_OCCURRENCE}
        startAt={startAt}
        endAt={endAt}
        createSocket={live.factory}
      />,
      host,
    ),
  );
  void act(() => {
    live.latest().open();
    live.latest().deliver(snapshot);
  });
  return { host, live };
}

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

function openThread(
  host: HTMLElement,
  live: ReturnType<typeof fakeLiveSockets>,
  answers: LiveQuestionAnswer[],
  rights: { canAnswer?: boolean; canAccept?: boolean; canVote?: boolean; canModerate?: boolean } = {},
) {
  void act(() => labeled(host, "Show answers").click());
  void act(() =>
    live.latest().deliver({
      type: "question.answers",
      questionId: LIVE_QUESTION,
      answers,
      canAnswer: rights.canAnswer ?? true,
      canAccept: rights.canAccept ?? false,
      canVote: rights.canVote ?? true,
      canModerate: rights.canModerate ?? false,
    }),
  );
}

function labeled(root: ParentNode, name: string): HTMLButtonElement {
  const found = [...root.querySelectorAll("button")].find(
    (candidate) => candidate.getAttribute("aria-label") === name || candidate.textContent?.trim() === name,
  );
  if (!found) throw new Error(`No button named ${name}`);
  return found;
}

describe("answer threads", () => {
  it("summarizes the thread, upvotes others' answers and accepts with a pressed icon button", () => {
    const { host, live } = mount(
      liveSnapshot({ questions: [liveQuestion({ mine: true, answerCount: 2, acceptedAnswer: true })] }),
    );
    expect(host.querySelector(".pk-live-answers__summary")?.textContent).toContain("2 answers");
    expect(host.querySelector(".pk-live-answers__summary")?.textContent).toContain("Accepted answer");
    const other = answer({ votes: 1 });
    const own = answer({ text: "Mine", mine: true });
    openThread(host, live, [other, own], { canAccept: true });
    const upvote = labeled(host, "Upvote answer: 1 vote");
    expect(upvote.title).toBe("Moves helpful answers up. Others don't see who voted.");
    expect(labeled(host, "Your answer: 0 votes").disabled).toBe(true);
    void act(() => upvote.click());
    expect(live.latest().messages().at(-1)).toEqual({
      type: "question.answer.vote",
      questionId: LIVE_QUESTION,
      answerId: other.id,
      voted: true,
    });
    const accept = host.querySelectorAll<HTMLButtonElement>('button[aria-label="Accept answer"]')[0];
    expect(accept.getAttribute("aria-pressed")).toBe("false");
    expect(accept.title).toBe("Marks this as the answer to your question. Everyone sees it first.");
    expect(accept.querySelector("svg")).not.toBeNull();
  });

  it("shows the author their removed answer and why, and nobody's name", () => {
    const { host, live } = mount(liveSnapshot({ questions: [liveQuestion()] }));
    openThread(host, live, [
      answer({ mine: true, removal: { reason: "spam", at: "2026-10-16T12:01:00.000Z", byName: null } }),
    ]);
    expect(host.textContent).toContain("Removed by a moderator: Spam. Only you can see this.");
  });

  it("replaces every post box with the warning while a person is blocked, and keeps the thread readable", () => {
    const { host, live } = mount(
      liveSnapshot({
        viewer: { role: "attendee", name: "Ada Attendee", participation: { block: "session", until: null } },
        questions: [liveQuestion()],
      }),
    );
    expect(host.querySelector("textarea")).toBeNull();
    expect(host.textContent).toContain("You can't post in this session.");
    openThread(host, live, [answer()], { canAnswer: true, canVote: true });
    expect(host.textContent).toContain("Automate renewal first.");
    expect(host.querySelector("textarea")).toBeNull();
    expect(host.querySelectorAll('a[href="/code-of-conduct/"]')).toHaveLength(2);
    expect(labeled(host, "Upvote answer: 0 votes").disabled).toBe(true);
  });

  it("asks a moderator why before removing an answer", async () => {
    const { host, live } = mount(
      liveSnapshot({ viewer: { role: "operator", name: "Olga Operator" }, questions: [liveQuestion()] }),
    );
    const spam = answer({ revision: 2 });
    openThread(host, live, [spam], { canModerate: true });
    await act(async () => labeled(host, "Actions for answer from Alex Moreau").click());
    const remove = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => item.textContent?.trim() === "Remove answer…",
    )!;
    expect(remove.title).toBe("Hides it from everyone and records why. The author sees the reason.");
    await act(async () => remove.click());
    const dialog = document.querySelector("dialog")!;
    expect(dialog.textContent).toContain("Remove this answer?");
    const before = live.latest().messages().length;
    await act(async () => labeled(dialog, "Remove answer").click());
    expect(live.latest().messages()).toHaveLength(before);
    await act(async () => dialog.querySelector<HTMLInputElement>('input[value="spam"]')!.click());
    await act(async () => labeled(dialog, "Remove answer").click());
    expect(live.latest().messages().at(-1)).toEqual({
      type: "question.answer.hide",
      questionId: LIVE_QUESTION,
      answerId: spam.id,
      hidden: true,
      reason: "spam",
      expectedRevision: 2,
    });
  });
});
