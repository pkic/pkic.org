import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { liveRoomClientMessageSchema, type LiveChatMessage } from "../../assets/shared/schemas/live-session-room";
import { applyLocationChatMessage } from "../../assets/ts/live-session/location-chat-state";
import { LiveChatPanel } from "../../assets/ts/member-flows/portal/sections/events/detail/live/LiveChatPanel";
import { liveChatMessage, liveLocationChatSnapshot } from "./helpers/live-room-socket";

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) {
    render(null, host);
    host.remove();
  }
  window.history.replaceState(null, "", "#/");
});

const moderation = (overrides: Partial<NonNullable<LiveChatMessage["moderation"]>> = {}) => ({
  hidden: null,
  done: null,
  held: false,
  reports: 0,
  reportReasons: {},
  questionId: null,
  authorStaff: false,
  authorRestriction: null,
  ...overrides,
});

const REMOVED = liveChatMessage({
  id: "40000000-0000-4000-8000-000000000021",
  text: "Visit booth 12 for 20% off",
  moderation: moderation({
    held: true,
    hidden: { operatorName: "Automatic check", at: new Date().toISOString() },
    automaticCheck: {
      outcome: "blocked",
      notes: ["Sales pitches aren't allowed in the chat."],
      flags: [
        { id: "solicitation", percent: 96 },
        { id: "spam", percent: 72 },
      ],
    },
  }),
});
const REPORTED = liveChatMessage({
  id: "40000000-0000-4000-8000-000000000022",
  text: "Check out my channel",
  moderation: moderation({ reports: 2, reportReasons: { spam: 2 } }),
});

function mount(chat: LiveChatMessage[], chatReports: LiveChatMessage[], hash = "#/events/pqc/live") {
  window.history.replaceState(null, "", hash);
  const state = applyLocationChatMessage(
    null,
    liveLocationChatSnapshot({ viewer: { role: "operator", name: "Ada" }, chat, chatReports }),
  )!;
  const send = vi.fn((_message: unknown) => true);
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  void act(() => render(<LiveChatPanel studio state={state} disabled={false} send={send} />, host));
  return { host, send };
}

const menuLabels = () =>
  [...document.querySelectorAll<HTMLElement>('[role="menu"] > [role^="menuitem"]')].map((item) =>
    item.textContent?.trim(),
  );

async function openMenu(row: Element) {
  await act(async () =>
    row.querySelector<HTMLButtonElement>('.pk-live-chat__menu button[aria-label^="Actions for message"]')!.click(),
  );
}

describe("the studio chat's Review tab", () => {
  it("shows the words and why each message is here, removed ones first, and opens the menu on the decision", async () => {
    const { host } = mount([], [REPORTED, REMOVED], "#/events/pqc/live?chat=review");
    const rows = [...host.querySelectorAll("#studio-review-list li")];
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Visit booth 12 for 20% off"),
      expect.stringContaining("Check out my channel"),
    ]);
    expect(rows[0]!.textContent).toContain("Removed by check · Solicitation 96%");
    expect(rows[0]!.querySelector<HTMLElement>(".pk-live-chat__note[title]")?.title).toContain("Spam: 72%");
    expect(rows[1]!.textContent).toContain("2 reports · Spam");
    await openMenu(rows[0]!);
    const labels = menuLabels();
    expect(labels.slice(0, 2)).toEqual(["Keep message", "Hide message…"]);
    expect(labels).toContain("Pause user for 10 minutes");
    // Keeping or hiding is the review here; the separate reviewed mark stays in the main chat.
    expect(labels).not.toContain("Mark as reviewed");
  });

  it("counts each filter and narrows the queue to it", async () => {
    const { host } = mount([], [REPORTED, REMOVED], "#/events/pqc/live?chat=review");
    expect(host.querySelector("#studio-review-reported")?.textContent).toBe("Reported · 1");
    await act(async () => host.querySelector<HTMLButtonElement>("#studio-review-reported")!.click());
    expect(window.location.hash).toContain("review=reported");
    expect(host.querySelectorAll("#studio-review-list li")).toHaveLength(1);
    expect(host.querySelector("#studio-review-list")?.textContent).toContain("Check out my channel");
  });
});

describe("marking a chat message as reviewed", () => {
  it("marks it in the main chat and takes the mark back from the same menu", async () => {
    const message = liveChatMessage({ moderation: moderation() });
    const first = mount([message], []);
    await openMenu(first.host.querySelector(".pk-live-chat__list li")!);
    const mark = [...document.querySelectorAll<HTMLElement>('[role="menu"] [role^="menuitem"]')].find(
      (item) => item.textContent?.trim() === "Mark as reviewed",
    )!;
    await act(async () => mark.click());
    expect(liveRoomClientMessageSchema.parse(first.send.mock.calls.at(-1)![0])).toEqual({
      type: "moderation.done",
      item: { kind: "chat", messageId: message.id },
      done: true,
    });

    const reviewed = {
      ...message,
      moderation: moderation({ done: { operatorName: "Ada", at: new Date().toISOString() } }),
    };
    const second = mount([reviewed], []);
    const row = second.host.querySelectorAll(".pk-live-chat__list li")[0]!;
    expect(row.textContent).toContain("Reviewed");
    await openMenu(row);
    const back = [...document.querySelectorAll<HTMLElement>('[role="menu"] [role^="menuitem"]')].find(
      (item) => item.textContent?.trim() === "Back to review",
    )!;
    await act(async () => back.click());
    expect(liveRoomClientMessageSchema.parse(second.send.mock.calls.at(-1)![0])).toEqual({
      type: "moderation.done",
      item: { kind: "chat", messageId: message.id },
      done: false,
    });
  });
});
