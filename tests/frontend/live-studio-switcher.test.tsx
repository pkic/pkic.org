// @vitest-environment jsdom
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { liveSnapshot } from "./helpers/live-room-socket";
import {
  OPERATOR,
  button,
  commands,
  labeled,
  mountDesk,
  panel,
  resetDeskStorage,
  take,
  unmountDesks,
} from "./helpers/live-desk";

beforeEach(resetDeskStorage);
afterEach(unmountDesks);

describe("the studio's switcher, session bar and phone layout", () => {
  it("runs one panel at a time on a phone, behind a tab bar, with Preview, Program and the Transition always in reach", async () => {
    vi.stubGlobal(
      "matchMedia",
      (query: string) =>
        ({
          matches: query.includes("max-width"),
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    );
    try {
      const { host, live } = mountDesk();
      const bar = host.querySelector(".pk-studio-phone__bar")!;
      // Preview and Program are the pictures alone until one is touched.
      expect(bar.querySelector(".pk-studio-phone__thumb-tag")).toBeNull();
      expect(host.querySelector(".pk-studio-grid")).toBeNull();
      const tabs = [...host.querySelectorAll<HTMLButtonElement>(".pk-studio-phone__tab")];
      // Five tabs, each a glyph over a short label; the label is the tab's name.
      expect(tabs.map((tab) => tab.textContent)).toEqual(["Home", "Speakers", "Graphics", "Questions", "More"]);
      expect(tabs.every((tab) => tab.querySelector("svg[aria-hidden='true']"))).toBe(true);
      expect(tabs[0]!.getAttribute("aria-current")).toBe("page");

      // The phone opens on the quick actions, not on large monitors.
      const home = host.querySelector<HTMLElement>('section[aria-label="Quick actions"]')!;
      expect(home.querySelector(".pk-studio-monitor")).toBeNull();
      expect(home.querySelector('[aria-label="Speakers"] .pk-live-person button[aria-label^="Show "]')).not.toBeNull();
      void act(() => button(home, "Please wrap up").click());
      expect(commands(live).at(-1)).toEqual({
        type: "speaker.message",
        text: "Please wrap up",
        tone: "warning",
        flash: false,
      });
      expect(home.textContent).not.toMatch(/Take off air|Nothing on the stage display/);

      // A touch on Program shows its tag, Clear and Full screen on the picture.
      const program = bar.querySelector<HTMLButtonElement>('button[aria-label="Program"]')!;
      void act(() => program.click());
      expect(program.getAttribute("aria-expanded")).toBe("true");
      expect(bar.querySelector(".pk-studio-phone__thumb-tag")?.textContent).toBe("PGM");
      void act(() => bar.querySelector<HTMLButtonElement>('[aria-label="Clear Program"]')!.click());
      expect(commands(live).at(-1)).toEqual({ type: "program.clear" });
      void act(() => bar.querySelector<HTMLButtonElement>('[aria-label="Full screen Program"]')!.click());
      expect(document.querySelector("dialog[open] .pk-studio-monitor__screen")).not.toBeNull();
      // An empty output says so, as the monitors do, rather than showing a black screen.
      expect(document.querySelector("dialog[open] .pk-studio-monitor__idle")?.textContent).toMatch(
        /Nothing on air|No graphics on this output/,
      );
      void act(() => document.querySelector<HTMLButtonElement>('dialog[open] [aria-label="Close Program"]')!.click());

      // The views without a tab of their own are behind More, which says which one is open.
      await act(async () => tabs[4]!.click());
      const more = [...document.querySelectorAll('[role="menuitemradio"]')];
      expect(more.map((item) => item.textContent)).toEqual(["Monitors", "Time", "Message"]);
      void act(() => (more[1] as HTMLElement).click());
      expect(location.hash).toContain("panel=time");
      expect(host.querySelector('[aria-label="More, showing Time"]')).not.toBeNull();

      expect(host.querySelectorAll("section[aria-label]").length).toBeGreaterThan(0);
      void act(() => tabs[3]!.click());
      expect(location.hash).toContain("panel=questions");
      expect(host.querySelector('section[aria-label="Questions"]')).not.toBeNull();
      void act(() =>
        bar.querySelector<HTMLButtonElement>('.pk-studio-transition button[aria-label="Transition"]')!.click(),
      );
      expect(commands(live).at(-1)).toEqual({ type: "preview.take" });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("clears a ready-made message with a second tap and flashes it with a hold on a phone", () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "matchMedia",
      (query: string) =>
        ({
          matches: query.includes("max-width"),
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    );
    try {
      const { host, live } = mountDesk(
        liveSnapshot({
          viewer: OPERATOR,
          speakerMessage: { text: "Please wrap up", tone: "warning", flash: false, change: null },
        }),
      );
      const home = host.querySelector<HTMLElement>('section[aria-label="Quick actions"]')!;
      const wrapUp = button(home, "Please wrap up");
      expect(wrapUp.getAttribute("aria-pressed")).toBe("true");
      void act(() => wrapUp.click());
      expect(commands(live).at(-1)).toEqual({ type: "speaker.message", text: null, tone: "warning", flash: false });

      const questions = button(home, "Time for questions");
      void act(() => {
        questions.dispatchEvent(new Event("pointerdown", { bubbles: true }));
        vi.advanceTimersByTime(600);
        questions.dispatchEvent(new Event("pointerup", { bubbles: true }));
        questions.click();
      });
      // The hold flashes the message; the click that ends it is not a second tap.
      expect(commands(live).at(-1)).toMatchObject({ type: "speaker.message", text: "Time for questions", flash: true });
      expect(commands(live).filter((command) => command.type === "speaker.message")).toHaveLength(2);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("says when a session that has not started starts, never a day left", () => {
    const base = liveSnapshot({ viewer: OPERATOR });
    const startAt = new Date(Date.now() + 12 * 60_000 + 20_000).toISOString();
    const { host } = mountDesk(
      liveSnapshot({
        viewer: OPERATOR,
        session: { ...base.session, startAt, endAt: new Date(Date.now() + 42 * 60_000).toISOString() },
        timers: [{ ...base.timers[0]!, heldMs: 24 * 3_600_000 }],
      }),
    );
    expect(host.querySelector(".pk-studio-header__left")?.textContent).toBe("Starts in 12 min");
  });

  it("transitions with Space while nothing else has the key, never from a field", () => {
    const { host, live } = mountDesk();
    const space = (target: EventTarget) =>
      void act(
        () => void target.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true })),
      );
    space(document.body);
    expect(commands(live)).toEqual([{ type: "preview.take" }]);
    space(host.querySelector("button")!);
    space(panel(host, "Message to speaker").querySelector("input[name=text]")!);
    expect(commands(live)).toHaveLength(1);
    expect(take(host).getAttribute("title")).toBe(
      "Replace Program with Preview. This changes the overlay output, not the stream. Shortcut: Space.",
    );
  });

  it("offers every operator an Undo for a few seconds after Program is cleared", () => {
    vi.useFakeTimers();
    try {
      const { host, live } = mountDesk();
      const snapshotId = "30000000-0000-4000-8000-000000000001";
      void act(() =>
        live.latest().deliver({
          type: "program.cleared",
          snapshotId,
          change: { operatorName: "Remote Rita", at: new Date().toISOString() },
        }),
      );
      const toast = () => host.querySelector(".pk-studio__toast");
      expect(toast()?.textContent).toContain("Remote Rita took everything off air.");
      void act(() => button(toast()!, "Undo").click());
      expect(commands(live)).toEqual([{ type: "program.restore", snapshotId }]);
      expect(toast()).toBeNull();
      void act(() =>
        live.latest().deliver({
          type: "program.cleared",
          snapshotId: "30000000-0000-4000-8000-000000000002",
          change: { operatorName: "Olga Operator", at: new Date().toISOString() },
        }),
      );
      expect(toast()).not.toBeNull();
      void act(() => {
        vi.advanceTimersByTime(8000);
      });
      expect(toast()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens full screen, keeps Escape for open menus and asks before leaving full screen", () => {
    const { host } = mountDesk();
    const studio = host.querySelector<HTMLElement>(".pk-studio")!;
    // The control room is an app: it opens over the portal's navigation and footer.
    expect(studio.dataset.expanded).toBe("true");
    expect(labeled(host, "Exit full screen").getAttribute("aria-pressed")).toBe("true");
    const escape = () =>
      void act(
        () =>
          void document.body.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
          ),
      );
    // With a menu open, Escape belongs to the menu.
    void act(() => button(host, "Add panel").click());
    escape();
    expect(document.querySelector("dialog[open]")).toBeNull();
    void act(() => button(host, "Add panel").click());
    escape();
    expect(document.querySelector("dialog")?.textContent).toContain("Leave full screen?");
    void act(() => button(document.querySelector("dialog")!, "Stay in full screen").click());
    expect(studio.dataset.expanded).toBe("true");
    escape();
    void act(() => button(document.querySelector("dialog")!, "Leave full screen").click());
    expect(studio.dataset.expanded).toBeUndefined();
  });
});
