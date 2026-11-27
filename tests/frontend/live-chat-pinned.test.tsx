import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LiveChatMessage, LiveLocationChatSnapshot } from "../../assets/shared/schemas/live-session-room";
import { LiveChat } from "../../assets/ts/live-session/LiveChat";
import { applyLocationChatMessage, type LiveLocationChatState } from "../../assets/ts/live-session/location-chat-state";
import { liveLocationChatSnapshot } from "./helpers/live-room-socket";

const hosts: HTMLElement[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const host of hosts.splice(0)) {
    render(null, host);
    host.remove();
  }
});

const PINNED = "40000000-0000-4000-8000-000000000001";
const OPERATOR = { role: "operator" as const, name: "Rita", organizer: false };

function pinnedMessage(overrides: Partial<LiveChatMessage> = {}): LiveChatMessage {
  return {
    channel: "attendee",
    id: PINNED,
    text: "We are aware of the audio problem.",
    authorName: "Rita Moderator",
    mine: false,
    sentAt: new Date().toISOString(),
    moderation: null,
    ...overrides,
  };
}

function stateWith(overrides: Partial<Omit<LiveLocationChatSnapshot, "type">> = {}): LiveLocationChatState {
  const state = applyLocationChatMessage(null, liveLocationChatSnapshot(overrides));
  if (!state) throw new Error("No state");
  return state;
}

function mount(state: LiveLocationChatState, send = vi.fn(() => true)) {
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  void act(() => render(<LiveChat state={state} disabled={false} send={send} />, host));
  return host;
}

const bar = (host: HTMLElement) => host.querySelector('[aria-label="Pinned message"]');

describe("pinned chat message", () => {
  it("shows the pinned message above the chat, with Unpin for moderators only", async () => {
    const attendee = mount(stateWith({ chatPinned: pinnedMessage() }));
    expect(bar(attendee)?.textContent).toContain("We are aware of the audio problem.");
    expect(attendee.querySelector('button[aria-label="Unpin message"]')).toBeNull();

    const send = vi.fn(() => true);
    const moderator = mount(stateWith({ viewer: OPERATOR, chatPinned: pinnedMessage() }), send);
    await act(async () => moderator.querySelector<HTMLButtonElement>('button[aria-label="Unpin message"]')!.click());
    expect(send).toHaveBeenCalledWith({ type: "chat.unpin" });
  });

  it("shows a message longer than its line on hover, and keeps it shown once clicked", async () => {
    // jsdom lays nothing out: the pinned line reports words wider than itself.
    const cut = (property: "scrollWidth" | "clientWidth", width: number) =>
      vi.spyOn(HTMLElement.prototype, property, "get").mockImplementation(function (this: HTMLElement) {
        return this.classList.contains("pk-live-chat__pinned-text") ? width : 0;
      });
    cut("scrollWidth", 600);
    cut("clientWidth", 200);
    const host = mount(stateWith({ chatPinned: pinnedMessage() }));
    const pinned = bar(host)!;
    const point = (type: string, pointerType = "mouse") =>
      act(() => {
        pinned.dispatchEvent(Object.assign(new Event(type), { pointerType }));
      });
    const shown = () => pinned.hasAttribute("data-open");

    expect(shown()).toBe(false);
    await point("pointerenter");
    expect(shown()).toBe(true);
    await point("pointerleave");
    expect(shown()).toBe(false);
    // A tap does not count as resting on it.
    await point("pointerenter", "touch");
    expect(shown()).toBe(false);

    await point("pointerenter");
    const toggle = host.querySelector<HTMLButtonElement>('button[aria-label="Show all"]')!;
    await act(async () => toggle.click());
    await point("pointerleave");
    expect(shown()).toBe(true);
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Show less"]')!.click());
    expect(shown()).toBe(false);
  });

  it("shows nothing above the chat while no message is pinned", () => {
    expect(bar(mount(stateWith({ chat: [pinnedMessage()] })))).toBeNull();
  });

  it("follows the room: a new pin, an edit, and the message leaving", () => {
    let state: LiveLocationChatState | null = stateWith({ chat: [pinnedMessage()] });
    state = applyLocationChatMessage(state, { type: "chat.pinned", message: pinnedMessage() });
    expect(state?.chatPinned?.text).toBe("We are aware of the audio problem.");
    state = applyLocationChatMessage(state, {
      type: "chat.message",
      message: pinnedMessage({ text: "Audio is fixed.", editedAt: new Date().toISOString() }),
    });
    expect(state?.chatPinned?.text).toBe("Audio is fixed.");
    state = applyLocationChatMessage(state, { type: "chat.removed", messageId: PINNED, channel: "attendee" });
    expect(state?.chatPinned).toBeNull();
  });

  it("leaves the top of a moderator's chat once the message is hidden", () => {
    const hidden = pinnedMessage({
      moderation: {
        hidden: { operatorName: "Rita", at: new Date().toISOString() },
        done: null,
        held: false,
        reports: 0,
        reportReasons: {},
        questionId: null,
        authorStaff: true,
        authorRestriction: null,
      },
    });
    const state = applyLocationChatMessage(stateWith({ viewer: OPERATOR, chatPinned: pinnedMessage() }), {
      type: "chat.message",
      message: hidden,
    });
    expect(state?.chatPinned).toBeNull();
  });
});
