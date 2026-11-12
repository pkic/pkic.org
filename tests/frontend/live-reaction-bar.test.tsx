// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIVE_REACTIONS, LIVE_ROOM_POLICY } from "../../assets/shared/live-session-policy";
import { LIVE_REACTION_PAUSED } from "../../assets/ts/live-session/LiveReactionBar";
import { SessionReactions } from "../../assets/ts/live-session/SessionReactions";
import { LIVE_OCCURRENCE, fakeLiveSockets, liveSnapshot } from "./helpers/live-room-socket";

const { limit, windowSeconds } = LIVE_ROOM_POLICY.reactionsPerPerson;
let host: HTMLElement | undefined;

beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  if (host) {
    await act(() => render(null, host!));
    host.remove();
    host = undefined;
  }
  vi.useRealTimers();
});

/** The bar for a session running now, its room admitted. */
async function mountBar() {
  const live = fakeLiveSockets();
  const now = Date.now();
  host = document.body.appendChild(document.createElement("div"));
  await act(() =>
    render(
      <SessionReactions
        slug="pqc-2026"
        occurrenceId={LIVE_OCCURRENCE}
        startAt={new Date(now - 10 * 60_000).toISOString()}
        endAt={new Date(now + 50 * 60_000).toISOString()}
        createSocket={live.factory}
      />,
      host!,
    ),
  );
  await act(() => {
    live.latest().open();
    live.latest().deliver(liveSnapshot());
  });
  const toolbar = () => host!.querySelector<HTMLElement>('[role="toolbar"]')!;
  const button = (label: string) => toolbar().querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
  const status = () => host!.querySelector('[role="status"]')!.textContent;
  const reactions = () =>
    live
      .latest()
      .messages()
      .filter((message) => message.type === "reaction.send");
  return { live, toolbar, button, status, reactions };
}

describe("the session's reaction bar", () => {
  it("names the bar and each reaction, and sends the one pressed", async () => {
    const bar = await mountBar();
    expect(bar.toolbar().getAttribute("aria-label")).toBe("React to this session");
    const buttons = [...bar.toolbar().querySelectorAll("button")];
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual(LIVE_REACTIONS.map((r) => r.label));
    // The emoji is decoration; the label is the name.
    for (const button of buttons) expect(button.querySelector('[aria-hidden="true"]')).not.toBeNull();
    // Each press is one reaction, not a toggle.
    expect(buttons.some((button) => button.hasAttribute("aria-pressed"))).toBe(false);
    await act(() => bar.button("Applause").click());
    await act(() => bar.button("Thumbs up").click());
    expect(bar.reactions()).toEqual([
      { type: "reaction.send", reaction: "applause" },
      { type: "reaction.send", reaction: "thumbs_up" },
    ]);
  });

  it("is one tab stop that arrows, Home and End move through", async () => {
    const bar = await mountBar();
    const buttons = () => [...bar.toolbar().querySelectorAll<HTMLButtonElement>("button")];
    expect(buttons().map((button) => button.tabIndex)).toEqual([0, -1, -1, -1, -1]);
    buttons()[0]!.focus();
    const press = (key: string) =>
      act(() => {
        document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      });
    await press("ArrowRight");
    expect(document.activeElement).toBe(buttons()[1]);
    await press("End");
    expect(document.activeElement).toBe(buttons()[4]);
    await press("ArrowRight");
    expect(document.activeElement).toBe(buttons()[0]);
    await press("ArrowLeft");
    expect(document.activeElement).toBe(buttons()[4]);
    await press("Home");
    expect(document.activeElement).toBe(buttons()[0]);
    expect(buttons().filter((button) => button.tabIndex === 0)).toEqual([buttons()[0]]);
  });

  it("pauses quietly at the room's limit, without sending, and picks up again after the window", async () => {
    const bar = await mountBar();
    expect(bar.status()).toBe("");
    for (let press = 0; press < limit + 3; press += 1) await act(() => bar.button("Love").click());
    expect(bar.reactions()).toHaveLength(limit);
    expect(bar.status()).toBe(LIVE_REACTION_PAUSED);
    expect(host!.querySelector('[role="alert"]')).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(windowSeconds * 1000 + 100);
    });
    expect(bar.status()).toBe("");
    await act(() => bar.button("Love").click());
    expect(bar.reactions()).toHaveLength(limit + 1);
  });

  it("pauses too when the room refuses a reaction as too fast", async () => {
    const bar = await mountBar();
    await act(() =>
      bar.live.latest().deliver({
        type: "room.refused",
        code: "LIVE_ROOM_RATE_LIMITED",
        message: "Please wait a moment before trying again.",
      }),
    );
    expect(bar.status()).toBe(LIVE_REACTION_PAUSED);
    await act(() => bar.button("Laugh").click());
    expect(bar.reactions()).toEqual([]);
  });
});
