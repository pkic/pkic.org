import { LiveChatPanel } from "../../assets/ts/member-flows/portal/sections/events/detail/live/LiveChatPanel";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LIVE_CHAT_POLICY, LIVE_CHAT_REACTIONS } from "../../assets/shared/live-chat-policy";
import {
  liveRoomClientMessageSchema,
  type LiveChatMessage,
  type LiveLocationChatSnapshot,
} from "../../assets/shared/schemas/live-session-room";
import { LiveChat } from "../../assets/ts/live-session/LiveChat";
import { applyLocationChatMessage, type LiveLocationChatState } from "../../assets/ts/live-session/location-chat-state";
import { LIVE_OCCURRENCE, liveLocationChatSnapshot } from "./helpers/live-room-socket";

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) {
    render(null, host);
    host.remove();
  }
});

const MESSAGE = "40000000-0000-4000-8000-000000000001";

function chatMessage(overrides: Partial<LiveChatMessage> = {}): LiveChatMessage {
  return {
    channel: "attendee",
    id: MESSAGE,
    text: "Welcome to the session",
    authorName: "Sam Speaker",
    authorPhotoUrl: null,
    mine: false,
    sentAt: new Date().toISOString(),
    reactions: {},
    myReactions: [],
    reportedByMe: false,
    moderation: null,
    ...overrides,
  };
}

function stateWith(overrides: Partial<Omit<LiveLocationChatSnapshot, "type">> = {}): LiveLocationChatState {
  const state = applyLocationChatMessage(null, liveLocationChatSnapshot({ chat: [chatMessage()], ...overrides }));
  if (!state) throw new Error("No state");
  return state;
}

function draw(node: preact.ComponentChild, host: HTMLElement) {
  render(
    <>
      {node}
      <ConfirmDialogHost />
    </>,
    host,
  );
}

function mount(node: preact.ComponentChild) {
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  void act(() => draw(node, host));
  return host;
}

/** The commands a chat sent, read as the room reads them. */
function sent(send: ReturnType<typeof vi.fn>) {
  return send.mock.calls.map(([message]) => liveRoomClientMessageSchema.parse(message));
}

/** What one sent command does, as the room reads it: its type, and the decision or block it carries. */
function effectOf(message: unknown): string {
  const command = liveRoomClientMessageSchema.parse(message);
  if (command.type === "chat.moderate") return `${command.type}:${command.decision}`;
  if (command.type === "participation.block") return `${command.type}:${command.block}`;
  return command.type;
}

/** Reply and Edit send nothing yet: they set the composer up, which this reads and then cancels. */
async function composed(host: HTMLElement): Promise<string> {
  const line = host.querySelector(".pk-live-chat__composing");
  if (!line) return "nothing";
  const cancel = line.querySelector<HTMLButtonElement>("button:last-of-type")!;
  const mode = cancel.getAttribute("aria-label") === "Cancel edit" ? "compose:edit" : "compose:reply";
  await act(async () => cancel.click());
  return mode;
}

/**
 * What each action a viewer gets on the first message does: the reaction button, then every menu item,
 * run through its submenu or dialog to the command it sends. Copy and order changes don't matter here.
 */
async function menuEffects(host: HTMLElement, send: ReturnType<typeof vi.fn>): Promise<string[]> {
  const effects = host.querySelector('.pk-live-chat__menu button[aria-label^="React to message"]')
    ? ["chat.react"]
    : [];
  const trigger = host.querySelector<HTMLButtonElement>(
    '.pk-live-chat__menu button[aria-label^="Actions for message"]',
  );
  if (!trigger) return effects;
  const items = () => document.querySelectorAll<HTMLElement>('[role="menu"] > [role^="menuitem"]');
  await act(async () => trigger.click());
  const count = items().length;
  await act(async () => trigger.click());
  for (let index = 0; index < count; index += 1) {
    await act(async () => trigger.click());
    const item = items()[index];
    const before = send.mock.calls.length;
    await act(async () => item.click());
    const submenu = document.getElementById(item.getAttribute("aria-controls") ?? "");
    const choice = submenu?.querySelector<HTMLElement>('[role^="menuitem"]');
    if (choice) await act(async () => choice.click());
    const dialog = document.querySelector("dialog");
    if (dialog) {
      const reason = dialog.querySelector<HTMLInputElement>('input[type="radio"]');
      if (reason) await act(async () => reason.click());
      const confirm = [...dialog.querySelectorAll("button")].at(-1)!;
      await act(async () => confirm.click());
    }
    effects.push(send.mock.calls.length > before ? effectOf(send.mock.calls.at(-1)![0]) : await composed(host));
  }
  return effects;
}

describe("live chat", () => {
  it("validates and sends a message through the real room command, with Enter as send", () => {
    const send = vi.fn(() => true);
    const host = mount(<LiveChat state={stateWith()} disabled={false} send={send} />);
    const text = host.querySelector("textarea")!;
    void act(() => {
      text.value = "Good morning";
      text.dispatchEvent(new Event("input", { bubbles: true }));
    });
    void act(() => {
      text.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    expect(sent(send)).toEqual([{ type: "chat.send", text: "Good morning", channel: "attendee" }]);
    expect(text.value).toBe("");
    void act(() => {
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("keeps an empty composer at rest and reports a refusal on the status line above it", () => {
    const send = vi.fn(() => true);
    const host = mount(<LiveChat compact state={stateWith()} disabled={false} send={send} />);
    const text = host.querySelector("textarea")!;
    const button = host.querySelector<HTMLButtonElement>(".pk-live-chat__composer button[type='submit']")!;
    expect(button.disabled).toBe(true);
    void act(() => {
      text.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    expect(send).not.toHaveBeenCalled();
    expect(text.getAttribute("aria-invalid")).toBeNull();
    expect(host.querySelector(".pk-field__message")).toBeNull();
    void act(() => {
      text.value = "x".repeat(LIVE_CHAT_POLICY.storedMessages);
      text.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const status = document.getElementById(text.getAttribute("aria-describedby")!)!;
    expect(status.closest(".pk-live-chat__composer")?.firstElementChild).toBe(status);
    expect(status.textContent).toContain("Keep your message under");
    expect(button.disabled).toBe(true);
    expect(host.querySelector(".pk-field__message")).toBeNull();
  });

  it("draws a compact row with the author's photo, time, words and reaction counts", async () => {
    const send = vi.fn(() => true);
    const photo = "/api/v1/users/u1/headshots/portrait.jpg";
    const host = mount(
      <LiveChat
        state={stateWith({
          chat: [chatMessage({ authorPhotoUrl: photo, reactions: { thumbs_up: 3, love: 1 }, myReactions: ["love"] })],
        })}
        disabled={false}
        send={send}
      />,
    );
    const row = host.querySelector(".pk-live-chat__row")!;
    expect(
      row.querySelector("img")?.getAttribute("src") ?? row.querySelector("img")?.getAttribute("srcset"),
    ).toBeTruthy();
    expect(row.querySelector(".pk-live-chat__author")?.textContent).toBe("Sam Speaker");
    expect(row.querySelector("time")).not.toBeNull();
    const chips = [...row.querySelectorAll<HTMLButtonElement>(".pk-live-chat__reaction")];
    expect(chips.map((chip) => [chip.textContent?.trim(), chip.getAttribute("aria-pressed")])).toEqual([
      ["👍 3", "false"],
      ["❤️ 1", "true"],
    ]);
    await act(async () => chips[1].click());
    expect(sent(send)).toEqual([{ type: "chat.react", messageId: MESSAGE, reaction: "love", on: false }]);
    // Any reaction is one press away on the row itself, not behind the message's menu.
    const react = row.querySelector<HTMLButtonElement>('button[aria-label^="React to message"]')!;
    expect(react.title).toBe("Add a reaction");
    await act(async () => react.click());
    const picker = document.querySelector('[role="toolbar"][aria-label="Reactions"]')!;
    expect(document.querySelector('[role="menu"]')).toBeNull();
    const choices = [...picker.querySelectorAll<HTMLButtonElement>("button")];
    expect(choices.map((choice) => choice.getAttribute("aria-label"))).toEqual(
      LIVE_CHAT_REACTIONS.map((reaction) => reaction.label),
    );
    const thumbs = choices.find((choice) => choice.textContent?.includes("👍"))!;
    expect(thumbs.getAttribute("aria-pressed")).toBe("false");
    expect(choices.find((choice) => choice.textContent?.includes("❤️"))!.getAttribute("aria-pressed")).toBe("true");
    await act(async () => thumbs.click());
    expect(document.querySelector('[role="toolbar"]')).toBeNull();
    expect(sent(send).at(-1)).toEqual({ type: "chat.react", messageId: MESSAGE, reaction: "thumbs_up", on: true });
  });

  it("offers each viewer exactly the actions the chat policy grants", async () => {
    const send = vi.fn(() => true);
    const attendee = mount(<LiveChat state={stateWith()} disabled={false} send={send} />);
    expect(await menuEffects(attendee, send)).toEqual(["chat.react", "compose:reply", "chat.report"]);
    const own = mount(
      <LiveChat state={stateWith({ chat: [chatMessage({ mine: true })] })} disabled={false} send={send} />,
    );
    expect(await menuEffects(own, send)).toEqual(["chat.react", "compose:reply", "compose:edit", "chat.delete"]);
    const moderation = {
      hidden: null,
      done: null,
      held: false,
      reports: 2,
      reportReasons: { spam: 2 },
      questionId: null,
      authorStaff: false,
      authorRestriction: null,
    };
    const moderator = mount(
      <LiveChat
        state={stateWith({
          viewer: { role: "operator", name: "Rita", organizer: false },
          chat: [chatMessage({ moderation })],
        })}
        disabled={false}
        send={send}
      />,
    );
    expect(await menuEffects(moderator, send)).toEqual([
      "chat.react",
      "compose:reply",
      "moderation.done",
      "chat.convert",
      "chat.pin",
      "chat.moderate:keep",
      "chat.moderate:remove",
      "participation.block:paused",
      "participation.block:session",
    ]);
    // A moderator's own message is theirs to delete; removing with a reason is for someone else's.
    const ownAsModerator = mount(
      <LiveChat
        state={stateWith({
          viewer: { role: "operator", name: "Rita", organizer: false },
          chat: [
            chatMessage({
              mine: true,
              moderation: { ...moderation, reports: 0, reportReasons: {}, authorStaff: true },
            }),
          ],
        })}
        disabled={false}
        send={send}
      />,
    );
    const ownEffects = await menuEffects(ownAsModerator, send);
    expect(ownEffects).toContain("chat.delete");
    expect(ownEffects).not.toContain("chat.moderate:remove");
    const organizer = mount(
      <LiveChat
        state={stateWith({
          viewer: { role: "operator", name: "Olga", organizer: true },
          chat: [chatMessage({ moderation })],
        })}
        disabled={false}
        send={send}
      />,
    );
    expect(await menuEffects(organizer, send)).toEqual([
      "chat.react",
      "compose:reply",
      "moderation.done",
      "chat.convert",
      "chat.pin",
      "chat.moderate:keep",
      "chat.moderate:remove",
      "participation.block:paused",
      "participation.block:session",
      "participation.block:event",
    ]);
  });

  it("renders the chat subset of Markdown and never markup or script links", () => {
    const text = [
      "**bold** *italic* `code`\nnext line",
      "<script>alert(1)</script><img src=x onerror=alert(1)>",
      "[click](javascript:alert(1)) [site](https://example.org/talk) [local](/api/v1/users/current)",
      "# Not a heading",
    ].join("\n\n");
    const host = mount(
      <LiveChat state={stateWith({ chat: [chatMessage({ text })] })} disabled={false} send={vi.fn(() => true)} />,
    );
    const words = host.querySelector(".pk-live-chat__text")!;
    expect(words.querySelector("strong")?.textContent).toBe("bold");
    expect(words.querySelector("em")?.textContent).toBe("italic");
    expect(words.querySelector("code")?.textContent).toBe("code");
    expect(words.querySelector("script, img, h1, h2")).toBeNull();
    expect(words.textContent).toContain("<script>alert(1)</script>");
    const links = [...words.querySelectorAll("a")];
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["https://example.org/talk"]);
    expect(links[0].getAttribute("rel")?.split(" ")).toEqual(expect.arrayContaining(["noopener", "nofollow", "ugc"]));
    expect(words.querySelectorAll("br").length).toBeGreaterThan(0);
  });

  it("links a pasted address in full, scheme included, and opens it in a new tab", () => {
    const host = mount(
      <LiveChat
        state={stateWith({ chat: [chatMessage({ text: "https://www.google.com" })] })}
        disabled={false}
        send={vi.fn(() => true)}
      />,
    );
    const words = host.querySelector(".pk-live-chat__text")!;
    const links = [...words.querySelectorAll("a")];
    expect(links).toHaveLength(1);
    expect(links[0].textContent).toContain("https://www.google.com");
    expect(links[0].getAttribute("href")).toBe("https://www.google.com/");
    expect(links[0].getAttribute("target")).toBe("_blank");
    expect(links[0].getAttribute("rel")?.split(" ")).toEqual(expect.arrayContaining(["noopener", "noreferrer"]));
    expect(links[0].textContent).toContain("(opens in a new tab)");
    expect(words.textContent?.startsWith("https://www.google.com")).toBe(true);
  });

  it("keeps a long feed to a window of rows and pages back through the room", async () => {
    const start = Date.now() - 3_600_000;
    const chat = Array.from({ length: LIVE_CHAT_POLICY.clientWindow - 10 }, (_, index) =>
      chatMessage({
        id: `40000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        text: `Message ${index}`,
        sentAt: new Date(start + index * 1000).toISOString(),
      }),
    );
    const send = vi.fn(() => true);
    const host = mount(
      <LiveChat compact state={stateWith({ chat, chatEarlier: { attendee: true } })} disabled={false} send={send} />,
    );
    const rows = host.querySelectorAll(".pk-live-chat__row");
    expect(rows.length).toBeLessThan(60);
    expect(rows[rows.length - 1].textContent).toContain(`Message ${chat.length - 1}`);
    expect(host.querySelector(".pk-live-chat__spacer")).not.toBeNull();
    const earlier = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Load earlier messages",
    )!;
    await act(async () => earlier.click());
    expect(sent(send)).toEqual([{ type: "chat.history", channel: "attendee", before: chat[0].id }]);
  });

  it("shows a blocked person why they can't post, and keeps the chat readable", () => {
    const paused = mount(
      <LiveChat
        state={stateWith({
          viewer: {
            role: "attendee",
            name: "Ada",
            participation: { block: "paused", until: new Date(Date.now() + 600_000).toISOString() },
          },
        })}
        disabled={false}
        send={vi.fn(() => true)}
      />,
    );
    expect(paused.querySelector("textarea")).toBeNull();
    expect(paused.querySelector('[role="alert"]')).not.toBeNull();
    expect(paused.querySelector('a[href="/code-of-conduct/"]')).not.toBeNull();
    expect(paused.textContent).toContain("Welcome to the session");
    const blocked = mount(
      <LiveChat
        state={stateWith({ viewer: { role: "attendee", name: "Ada", participation: { block: "event", until: null } } })}
        disabled={false}
        send={vi.fn(() => true)}
      />,
    );
    expect(blocked.querySelector("textarea")).toBeNull();
    expect(blocked.querySelector('[role="alert"]')).not.toBeNull();
    expect(blocked.textContent).toContain("Welcome to the session");
  });

  it("gives a paused person their reactions and reporting back when the pause ends", async () => {
    vi.useFakeTimers();
    try {
      const send = vi.fn(() => true);
      const host = mount(
        <LiveChat
          state={stateWith({
            viewer: {
              role: "attendee",
              name: "Ada",
              participation: { block: "paused", until: new Date(Date.now() + 1_000).toISOString() },
            },
          })}
          disabled={false}
          send={send}
        />,
      );
      expect(await menuEffects(host, send)).toEqual([]);
      void act(() => {
        vi.advanceTimersByTime(1_100);
      });
      expect(host.querySelector("textarea")).not.toBeNull();
      expect(await menuEffects(host, send)).toEqual(["chat.react", "compose:reply", "chat.report"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks where the session on changes, and the breaks between", () => {
    const at = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
    const host = mount(
      <LiveChat
        state={stateWith({
          chat: [
            chatMessage({ id: "40000000-0000-4000-8000-000000000021", text: "Early", sentAt: at(-30) }),
            chatMessage({
              id: "40000000-0000-4000-8000-000000000022",
              text: "Hello",
              sentAt: at(-5),
              occurrenceId: LIVE_OCCURRENCE,
            }),
            chatMessage({
              id: "40000000-0000-4000-8000-000000000023",
              text: "Agreed",
              sentAt: at(-4),
              occurrenceId: LIVE_OCCURRENCE,
            }),
            chatMessage({ id: "40000000-0000-4000-8000-000000000024", text: "Coffee?", sentAt: at(-1) }),
          ],
        })}
        disabled={false}
        send={vi.fn(() => true)}
      />,
    );
    expect(
      [...host.querySelectorAll(".pk-live-chat__row")].map(
        (row) => row.querySelector('[role="separator"]')?.textContent ?? "",
      ),
    ).toEqual(["", "Post-quantum migration", "", "Between sessions"]);
  });
});

it("counts only new inactive-channel messages, lists reports and restores the selected studio view from its URL", async () => {
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
  expect(host.querySelector("#studio-chat-reports")?.textContent).toBe("Reports1");
  const updated = {
    ...initial,
    chat: [...initial.chat, { ...initial.chat[0], id: "40000000-0000-4000-8000-000000000003", text: "New cue" }],
  };
  await act(async () => draw(<LiveChatPanel studio state={updated} disabled={false} send={send} />, host));
  expect(host.querySelector("#studio-chat-operator")?.textContent).toContain("New");
  await act(async () => host.querySelector<HTMLButtonElement>("#studio-chat-reports")!.click());
  expect(window.location.hash).toContain("chat=reports");
  expect(host.querySelector("#studio-chat-panel-reports")?.textContent).toContain("1 report");
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
