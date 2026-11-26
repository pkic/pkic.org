import { act } from "preact/test-utils";
import { expect, it, vi } from "vitest";
import { LiveChat } from "../../assets/ts/live-session/LiveChat";
import { LiveChatPanel } from "../../assets/ts/member-flows/portal/sections/events/detail/live/LiveChatPanel";
import { chatMessage, draw, mount, stateWith } from "./helpers/live-chat-harness";

it("counts only new inactive-channel messages, lists what to review and restores the selected studio view from its URL", async () => {
  window.history.replaceState(null, "", "#/events/pqc/live");
  const reported = chatMessage({
    id: "40000000-0000-4000-8000-000000000009",
    moderation: {
      hidden: null,
      done: null,
      held: false,
      reports: 1,
      reportReasons: { abuse: 1 },
      questionId: null,
      authorStaff: false,
      authorRestriction: null,
    },
  });
  const initial = stateWith({
    viewer: { role: "operator", name: "Ada" },
    chat: [chatMessage({ id: "40000000-0000-4000-8000-000000000002", channel: "operator", text: "Existing history" })],
    chatReports: [reported],
  });
  const send = vi.fn(() => true);
  const host = mount(<LiveChatPanel studio state={initial} disabled={false} send={send} />);
  expect(host.querySelector("#studio-chat-operator")?.textContent).toBe("Operators");
  expect(host.querySelector("#studio-chat-review")?.textContent).toBe("Review1");
  const updated = {
    ...initial,
    chat: [...initial.chat, { ...initial.chat[0], id: "40000000-0000-4000-8000-000000000003", text: "New cue" }],
  };
  await act(async () => draw(<LiveChatPanel studio state={updated} disabled={false} send={send} />, host));
  expect(host.querySelector("#studio-chat-operator")?.textContent).toContain("New");
  await act(async () => host.querySelector<HTMLButtonElement>("#studio-chat-review")!.click());
  expect(window.location.hash).toContain("chat=review");
  expect(host.querySelector("#studio-chat-panel-review")?.textContent).toContain("1 report · Abuse");
  await act(async () => host.querySelector<HTMLButtonElement>("#studio-chat-operator")!.click());
  expect(host.querySelector("#studio-chat-operator")?.textContent).toBe("Operators");
  window.history.replaceState(null, "", "#/");
});

it("keeps studio scrollback stable and follows new messages only while already at the latest message", async () => {
  const at = (offset: number) => new Date(Date.now() + offset).toISOString();
  const state = stateWith({ chat: [chatMessage({ id: "40000000-0000-4000-8000-000000000011", sentAt: at(0) })] });
  const send = vi.fn(() => true);
  const host = mount(<LiveChat compact state={state} disabled={false} send={send} />);
  const feed = host.querySelector<HTMLElement>(".pk-live-chat")!;
  Object.defineProperties(feed, {
    clientHeight: { configurable: true, value: 100 },
    scrollHeight: { configurable: true, value: 500 },
  });
  feed.scrollTop = 0;
  feed.dispatchEvent(new Event("scroll"));
  const second = {
    ...state,
    chat: [...state.chat, chatMessage({ id: "40000000-0000-4000-8000-000000000012", sentAt: at(1) })],
  };
  await act(async () => draw(<LiveChat compact state={second} disabled={false} send={send} />, host));
  expect(feed.scrollTop).toBe(0);
  expect(host.textContent).toContain("1 new message");
  feed.scrollTop = 400;
  feed.dispatchEvent(new Event("scroll"));
  const third = {
    ...second,
    chat: [...second.chat, chatMessage({ id: "40000000-0000-4000-8000-000000000013", sentAt: at(2) })],
  };
  await act(async () => draw(<LiveChat compact state={third} disabled={false} send={send} />, host));
  expect(feed.scrollTop).toBe(500);
  expect(host.querySelectorAll(".pk-live-chat__row")).toHaveLength(3);
});

it("lets a wheel or trackpad leave the latest message with a small move up", async () => {
  const state = stateWith();
  const send = vi.fn(() => true);
  const host = mount(<LiveChat compact state={state} disabled={false} send={send} />);
  const feed = host.querySelector<HTMLElement>(".pk-live-chat")!;
  Object.defineProperties(feed, {
    clientHeight: { configurable: true, value: 100 },
    scrollHeight: { configurable: true, value: 500 },
  });
  feed.scrollTop = 400;
  feed.dispatchEvent(new Event("scroll"));
  // One wheel step up, well within the slack that still counts as reading the latest message when moving down.
  feed.scrollTop = 390;
  feed.dispatchEvent(new Event("scroll"));
  await act(async () => draw(<LiveChat compact state={{ ...state }} disabled={false} send={send} />, host));
  expect(feed.scrollTop).toBe(390);
});
