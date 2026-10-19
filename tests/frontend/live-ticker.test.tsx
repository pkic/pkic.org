import type { LiveRoomClientMessage } from "../../assets/shared/schemas/live-session-room";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveTickerMessages } from "../../assets/shared/live-ticker-content";
import {
  DEFAULT_LIVE_TICKER_CONFIG,
  liveTickerConfigSchema,
  readStoredLiveTicker,
  liveTickerSchema,
  type LiveTickerConfig,
} from "../../assets/shared/schemas/live-session-ticker";
import { agendaOccurrenceSchema, agendaRoomSchema } from "../../assets/shared/schemas/event-agenda";
import { liveSnapshot, liveTargets } from "./helpers/live-room-socket";
import { applyLiveRoomMessage } from "../../assets/ts/live-session/live-room-state";
import type { LiveTargets } from "../../assets/ts/member-flows/portal/sections/events/detail/live/live-output-targets";

function tickerTargets(stage: ReturnType<typeof liveSnapshot>["stage"], overrides: Partial<LiveTargets>) {
  // Preview starts as Program shows it, as the room's shared Preview does.
  const state = applyLiveRoomMessage(null, liveSnapshot({ stage, preview: stage }));
  if (!state) throw new Error("Missing fixture");
  return liveTargets(state, { programActive: false, ...overrides });
}
import { LiveTickerControls } from "../../assets/ts/member-flows/portal/sections/events/detail/live/LiveTickerControls";
import { LiveTickerOverlay } from "../../assets/ts/live-session/LiveTickerOverlay";
const id = (value: number) => `20000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const message = (
  template: string,
  prefix = "Next",
  condition: "always" | "near-session-end" = "always",
): LiveTickerConfig => ({ style: "gradient", messages: [{ id: "one", prefix, template, condition }] });
const occurrence = (value: number, room: number, title: string, start: string, end: string) =>
  agendaOccurrenceSchema.parse({
    id: id(value),
    roomId: id(room),
    title,
    startAt: start,
    endAt: end,
    speakers: [{ userId: id(value + 50), displayName: `Speaker ${value}` }],
    description: "",
  });
const agenda = () => ({
  rooms: [
    agendaRoomSchema.parse({ id: id(1), name: "Room A", capacity: null }),
    agendaRoomSchema.parse({ id: id(2), name: "Room B", capacity: null }),
  ],
  occurrences: [
    occurrence(3, 1, "Current", "2030-01-01T09:00:00.000Z", "2030-01-01T10:00:00.000Z"),
    occurrence(4, 1, "First next", "2030-01-01T10:00:00.000Z", "2030-01-01T11:00:00.000Z"),
    occurrence(5, 1, "Following next", "2030-01-01T11:00:00.000Z", "2030-01-01T12:00:00.000Z"),
    occurrence(6, 2, "Other room next", "2030-01-01T10:00:00.000Z", "2030-01-01T11:00:00.000Z"),
  ],
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("multi-message live ticker", () => {
  it("recomputes next/following speakers and countdown with clock changes and approved corrections", () => {
    vi.setSystemTime(Date.parse("2030-01-01T09:56:00.000Z"));
    const approved = agenda(),
      config = message("{{next.title}} · {{next.speakers}} · {{next.time}} · {{next.in}} · {{after_next.title}}");
    expect(resolveTickerMessages(config, approved, id(3), Date.now())[0].markdown).toBe(
      "First next · Speaker 4 · 10:00 · 4 min · Following next",
    );
    approved.occurrences[1].title = "Approved correction";
    expect(resolveTickerMessages(config, approved, id(3), Date.now())[0].markdown).toContain("Approved correction");
    vi.setSystemTime(Date.parse("2030-01-01T10:01:00.000Z"));
    expect(
      resolveTickerMessages(message("{{next.title}} · {{next.in}}"), approved, id(3), Date.now())[0].markdown,
    ).toBe("Following next · 59 min");
  });
  it("resolves message conditions, greetings, public sponsor tiers and omits empty/private/placeholder messages", () => {
    const approved = agenda(),
      now = Date.parse("2030-01-01T09:56:00.000Z"),
      context = { timeZone: "UTC", sponsorGroups: [{ key: "gold", tier: "Gold", names: ["Synthetic Sponsor"] }] };
    approved.occurrences.push({
      ...approved.occurrences[1],
      id: id(7),
      title: "Private title",
      visibility: "private",
      startAt: "2030-01-01T09:57:00.000Z",
    });
    approved.occurrences.push({
      ...approved.occurrences[1],
      id: id(8),
      title: "Placeholder",
      placeholder: true,
      startAt: "2030-01-01T09:58:00.000Z",
    });
    const config: LiveTickerConfig = {
      style: "accent",
      messages: [
        { id: "welcome", prefix: "Welcome", template: "{{greeting}}", condition: "always" },
        { id: "next", prefix: "Next", template: "{{next.title}}", condition: "near-session-end" },
        { id: "support", prefix: "Thank you", template: "{{sponsors.summary}}", condition: "always" },
      ],
    };
    expect(resolveTickerMessages(config, approved, id(3), now, context).map((segment) => segment.markdown)).toEqual([
      "Good morning",
      "First next",
      "Gold: Synthetic Sponsor",
    ]);
    expect(
      resolveTickerMessages(config, approved, id(3), now - 600000, { timeZone: "UTC", sponsorGroups: [] }),
    ).toHaveLength(1);
    expect(resolveTickerMessages(message("{{other_rooms.next}}"), approved, id(3), now)[0].markdown).toContain(
      "Room B: Other room next",
    );
  });
  it("omits the default next-session message when the last session is ending", () => {
    const approved = agenda();
    approved.occurrences = approved.occurrences.slice(0, 1);
    const segments = resolveTickerMessages(
      DEFAULT_LIVE_TICKER_CONFIG,
      approved,
      id(3),
      Date.parse("2030-01-01T09:59:00.000Z"),
    );
    expect(segments.map((segment) => segment.id)).toEqual(["greeting", "questions"]);
  });
  it("uses actual public tier keys for tier-specific sponsor messages and omits unknown tiers", () => {
    const context = {
      timeZone: "UTC",
      sponsorGroups: [{ key: "diamond", tier: "Diamond", names: ["Synthetic Diamond Sponsor"] }],
    };
    expect(
      resolveTickerMessages(message("Thanks to {{sponsors.tier.diamond}}"), null, id(3), Date.now(), context)[0]
        .markdown,
    ).toBe("Thanks to Synthetic Diamond Sponsor");
    expect(resolveTickerMessages(message("{{sponsors.tier.unavailable}}"), null, id(3), Date.now(), context)).toEqual(
      [],
    );
    expect(liveTickerConfigSchema.safeParse(message("{{sponsors.tier.diamond}}")).success).toBe(true);
    expect(liveTickerConfigSchema.safeParse(message("{{sponsors.tier.bad/key}}")).success).toBe(false);
  });
  it("validates shared template syntax and safely normalizes previously saved custom ticker content", () => {
    expect(liveTickerConfigSchema.safeParse(message("{{unknown}}")).success).toBe(true);
    expect(liveTickerConfigSchema.safeParse(message("{{next.title")).success).toBe(false);
    expect(liveTickerConfigSchema.safeParse(message("x".repeat(501))).success).toBe(false);
    const retained = liveTickerSchema.parse(
      readStoredLiveTicker({ source: "custom", customText: "Keep {{literal}} <b>text</b>", text: "old" }),
    );
    expect(retained.messages[0].template).toContain("literal");
    expect(retained.segments).toEqual([]);
  });
  it("keeps all labels and messages in one track and renders Markdown without executing HTML", () => {
    const ticker = liveTickerSchema.parse({
      ...message("**Safe** <img src=x onerror=alert(1)>"),
      segments: [{ id: "one", prefix: "Next", markdown: "**Safe** <img src=x onerror=alert(1)>" }],
    });
    const host = document.createElement("div");
    document.body.append(host);
    try {
      void act(() => render(<LiveTickerOverlay ticker={ticker} />, host));
      expect(host.querySelector(".pk-live-ticker__label")?.textContent).toBe("Next");
      expect(host.querySelector(".pk-live-ticker__track .pk-live-ticker__label")?.textContent).toBe("Next");
      expect(host.querySelector(".pk-live-ticker__message strong")?.textContent).toBe("Safe");
      expect(host.querySelector("img")).toBeNull();
      expect(host.textContent).toContain("<img src=x onerror=alert(1)>");
    } finally {
      void act(() => render(null, host));
      host.remove();
    }
  });
  it("keeps every message in the same track across time and content refreshes", () => {
    vi.useFakeTimers();
    const host = document.createElement("div");
    const ticker = liveTickerSchema.parse({
      ...message("First"),
      segments: [
        { id: "one", prefix: "News", markdown: "**First**" },
        { id: "two", prefix: "Next", markdown: "*Second*" },
      ],
    });
    try {
      void act(() => render(<LiveTickerOverlay ticker={ticker} />, host));
      const track = host.querySelector(".pk-live-ticker__track");
      const accessible = host.querySelector(".pk-live-ticker__group:not([aria-hidden])")!;
      expect(accessible.textContent).toContain("NewsFirstNextSecond");
      void act(() => {
        vi.advanceTimersByTime(90000);
      });
      expect(host.querySelector(".pk-live-ticker__track")).toBe(track);
      ticker.segments[0].markdown = "Updated";
      void act(() => render(<LiveTickerOverlay ticker={{ ...ticker }} />, host));
      expect(host.querySelector(".pk-live-ticker__track")).toBe(track);
      expect(accessible.textContent).toContain("NewsUpdatedNextSecond");
    } finally {
      void act(() => render(null, host));
    }
  });
  it("renders nested sponsor sections through the canonical engine", () => {
    const config = message("{{#sponsors.tiers}}**{{tier}}**: {{#names}}{{.}}; {{/names}}{{/sponsors.tiers}}");
    expect(liveTickerConfigSchema.safeParse(config).success).toBe(true);
    expect(
      resolveTickerMessages(config, null, id(3), Date.now(), {
        timeZone: "UTC",
        sponsorGroups: [{ key: "gold", tier: "Gold", names: ["One", "Two"] }],
      })[0].markdown,
    ).toBe("**Gold**: One; Two; ");
  });
  it("adds a stable non-security message key when randomUUID is unavailable on an HTTP LAN", () => {
    vi.stubGlobal("crypto", {});
    const stage = liveSnapshot().stage,
      host = document.createElement("div");
    document.body.append(host);
    const send = vi.fn((command: LiveRoomClientMessage) => command.type === "preview.set");
    try {
      void act(() => render(<LiveTickerControls targets={tickerTargets(stage, { sendProgram: send })} />, host));
      void act(() => host.querySelector<HTMLButtonElement>('[aria-label="Edit ticker messages"]')!.click());
      const add = Array.from(document.querySelectorAll("button")).find(
        (button) => button.textContent === "Add message",
      )!;
      void act(() => add.click());
      // The messages are compact rows; the new one is added at the end and opened beside them.
      const rows = Array.from(
        document.querySelectorAll('[aria-label="Ticker messages, in the order they scroll"] > li'),
      );
      expect(rows.at(-1)?.hasAttribute("data-selected")).toBe(true);
      expect(document.querySelector(".pk-list-detail__detail-pane")?.textContent).toContain(
        `Message ${rows.length} · From the agenda`,
      );
      const last = rows.at(-1)!.querySelector<HTMLButtonElement>('button[aria-label$=" up"]')!;
      void act(() => last.click());
      expect(
        Array.from(document.querySelectorAll('[aria-label="Ticker messages, in the order they scroll"] > li'))
          .at(-2)
          ?.hasAttribute("data-selected"),
      ).toBe(true);
      void act(() =>
        Array.from(document.querySelectorAll("button"))
          .find((button) => button.textContent === "Done")!
          .click(),
      );
      void act(() =>
        Array.from(host.querySelectorAll("button"))
          .find((button) => button.textContent === "Preview")!
          .click(),
      );
      const payload = send.mock.calls[0][0];
      if (payload.type !== "preview.set" || !payload.composition.ticker) throw new Error("Expected a ticker sequence");
      expect(payload.composition.ticker.messages.at(-2)?.id).toBe("message-1");
    } finally {
      void act(() => render(null, host));
      host.remove();
    }
  });
  it("uses one compact output row and never claims inactive saved content is live", () => {
    const config = message("Saved sequence"),
      stage = {
        ...liveSnapshot().stage,
        ticker: { ...config, segments: [{ id: "one", prefix: "Next", markdown: "Saved sequence" }] },
      },
      program = vi.fn(() => true),
      host = document.createElement("div");
    document.body.append(host);
    try {
      void act(() => render(<LiveTickerControls targets={tickerTargets(stage, { sendProgram: program })} />, host));
      const buttons = Array.from(host.querySelectorAll("button"));
      expect(buttons).toHaveLength(4);
      const programButton = buttons.find((button) => button.textContent === "Program")!;
      expect(programButton.getAttribute("aria-pressed")).toBe("false");
      void act(() => programButton.click());
      expect(program).toHaveBeenCalledWith({ type: "stage.ticker", ticker: config });
      void act(() => buttons.find((button) => button.textContent === "Preview")!.click());
      expect(program).toHaveBeenLastCalledWith({ type: "preview.set", composition: { ticker: null } });
    } finally {
      void act(() => render(null, host));
      host.remove();
    }
  });
});
