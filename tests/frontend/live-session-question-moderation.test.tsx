// @vitest-environment jsdom
import { act } from "preact/test-utils";
import { describe, expect, it } from "vitest";
import { LIVE_QUESTION, liveQuestion, liveSnapshot } from "./helpers/live-room-socket";
import { button, connect, mount } from "./helpers/session-questions";

describe("session questions moderation", () => {
  it("lets a credited speaker mark an open question discussed", () => {
    const { host, live } = mount();
    connect(live, liveSnapshot({ viewer: { role: "speaker", name: "Sam Speaker" }, questions: [liveQuestion()] }));
    void act(() => button(host, "Mark discussed").click());
    expect(live.latest().messages()).toEqual([
      { type: "question.moderate", questionId: LIVE_QUESTION, expectedRevision: 0, status: "answered" },
    ]);
  });

  it("lets a room moderator approve a question waiting for moderation from its actions menu", async () => {
    const { host, live } = mount();
    connect(
      live,
      liveSnapshot({
        viewer: { role: "operator", name: "Mo Moderator" },
        questions: [liveQuestion({ status: "pending" })],
      }),
    );
    await act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Question actions"]')!.click());
    const approve = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => item.textContent === "Approve",
    );
    await act(() => approve!.click());
    expect(live.latest().messages()).toEqual([
      { type: "question.moderate", questionId: LIVE_QUESTION, expectedRevision: 0, status: "approved" },
    ]);
  });
});
