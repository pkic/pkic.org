import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import type { LiveRoomServerMessage } from "../../assets/shared/schemas/live-session-room";
import { LiveChat } from "../../assets/ts/live-session/LiveChat";
import { applyLocationChatMessage, type LiveLocationChatState } from "../../assets/ts/live-session/location-chat-state";
import { LIVE_CHAT_ANNOUNCE_MS } from "../../assets/ts/live-session/useLiveChatAnnouncement";
import { liveChatMessage, liveLocationChatSnapshot } from "./helpers/live-room-socket";

/** How the chat reads the room's answers: what it sent arriving, a history page, and a refusal. */

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) {
    render(null, host);
    host.remove();
  }
  vi.useRealTimers();
});

const START = Date.parse("2026-11-04T12:00:00.000Z");
const at = (second: number) => new Date(START + second * 1000).toISOString();
const id = (index: number) => `40000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

/** A chat on screen that takes the room's messages as they arrive, the way its page does. */
function chatOnScreen(snapshot: Parameters<typeof liveLocationChatSnapshot>[0] = {}) {
  let state = applyLocationChatMessage(null, liveLocationChatSnapshot(snapshot)) as LiveLocationChatState;
  const send = vi.fn(() => true);
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  const draw = () => render(<LiveChat state={state} disabled={false} send={send} />, host);
  void act(draw);
  return {
    host,
    send,
    receive: async (message: LiveRoomServerMessage) => {
      state = applyLocationChatMessage(state, message)!;
      await act(draw);
    },
  };
}

const refused = {
  type: "room.refused",
  code: "LIVE_CHAT_RATE_LIMITED",
  message: "Wait a moment before sending another chat message.",
} as const;

function write(host: HTMLElement, words: string) {
  const text = host.querySelector("textarea")!;
  void act(() => {
    text.value = words;
    text.dispatchEvent(new Event("input", { bubbles: true }));
  });
  void act(() => {
    text.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  });
  return text;
}

it("keeps a sent message in the composer until it arrives, and to send again when the room refuses it", async () => {
  const chat = chatOnScreen({ chat: [liveChatMessage({ id: id(1), sentAt: at(0) })] });
  const text = write(chat.host, "Good morning");
  expect(chat.send).toHaveBeenCalledTimes(1);
  await chat.receive(refused);
  expect(text.value).toBe("Good morning");
  expect(chat.host.querySelector(".pk-live-chat__composer")?.textContent).toContain("Wait a moment");

  write(chat.host, "Good morning");
  expect(chat.send).toHaveBeenCalledTimes(2);
  // Someone else's message is not the reader's own arriving.
  await chat.receive({ type: "chat.message", message: liveChatMessage({ id: id(2), text: "Hi", sentAt: at(1) }) });
  expect(text.value).toBe("Good morning");
  await chat.receive({
    type: "chat.message",
    message: liveChatMessage({ id: id(3), text: "Good morning", mine: true, sentAt: at(2) }),
  });
  expect(text.value).toBe("");
});

it("ends the wait for earlier messages on each answer, a page that adds nothing and a refusal alike", async () => {
  const chat = chatOnScreen({
    chat: [liveChatMessage({ id: id(1), sentAt: at(0) })],
    chatEarlier: { attendee: true },
  });
  const earlier = () => chat.host.querySelector<HTMLButtonElement>(".pk-live-chat__earlier button")!;
  await act(async () => earlier().click());
  expect(earlier().disabled).toBe(true);
  await chat.receive({ type: "chat.history", channel: "attendee", messages: [], hasEarlier: true });
  expect(earlier().disabled).toBe(false);

  await act(async () => earlier().click());
  expect(earlier().disabled).toBe(true);
  await chat.receive(refused);
  expect(earlier().disabled).toBe(false);
  expect(chat.send).toHaveBeenCalledTimes(2);
});

it("announces new messages at a calm pace, as a count when many arrive, and a reply to the reader at once", async () => {
  vi.useFakeTimers({ now: START });
  const chat = chatOnScreen({ chat: [liveChatMessage({ id: id(1), sentAt: at(0) })] });
  const spoken = () => chat.host.querySelector('[aria-live="polite"]')!.textContent;
  const arrive = (index: number, text: string, extra = {}) =>
    chat.receive({
      type: "chat.message",
      message: liveChatMessage({ id: id(index), text, sentAt: at(index), ...extra }),
    });
  expect(spoken()).toBe("");
  await arrive(2, "First");
  expect(spoken()).toBe("Sam Speaker: First");
  await arrive(3, "Second");
  await arrive(4, "Third");
  await arrive(5, "Fourth");
  expect(spoken()).toBe("Sam Speaker: First");
  await act(() => {
    vi.advanceTimersByTime(LIVE_CHAT_ANNOUNCE_MS);
  });
  expect(spoken()).toBe("3 new messages");

  // A reader further up hears nothing of the feed, but still hears a reply to them.
  const feed = chat.host.querySelector<HTMLElement>(".pk-live-chat")!;
  Object.defineProperties(feed, {
    clientHeight: { configurable: true, value: 100 },
    scrollHeight: { configurable: true, value: 500 },
  });
  feed.scrollTop = 0;
  feed.dispatchEvent(new Event("scroll"));
  await act(() => {
    vi.advanceTimersByTime(LIVE_CHAT_ANNOUNCE_MS);
  });
  await arrive(6, "Fifth");
  expect(spoken()).toBe("3 new messages");
  await arrive(7, "Thanks for asking", {
    replyTo: { messageId: id(1), authorName: "Ada Attendee", excerpt: "Welcome", mine: true },
  });
  expect(spoken()).toBe("Sam Speaker replied to you: Thanks for asking");
});
