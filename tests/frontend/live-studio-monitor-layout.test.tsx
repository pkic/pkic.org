// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIVE_OVERLAY_PRESET_LAYOUTS } from "../../assets/shared/live-overlay-layout-presets";
import { applyLiveRoomMessage } from "../../assets/ts/live-session/live-room-state";
import { monitorPanelView } from "../../assets/ts/member-flows/portal/sections/events/detail/live/studio/MonitorPanel";
import {
  STUDIO_LAYOUT_STORAGE_KEY,
  defaultStudioLayouts,
  loadStudioLayouts,
  studioLayoutsSchema,
} from "../../assets/ts/member-flows/portal/sections/events/detail/live/studio/studio-layout";
import { useStudioLayout } from "../../assets/ts/member-flows/portal/sections/events/detail/live/studio/useStudioLayout";
import { LIVE_QUESTION, liveSnapshot } from "./helpers/live-room-socket";

const stored = new Map<string, string>();
const storage = {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => void stored.set(key, value),
  removeItem: (key: string) => void stored.delete(key),
  clear: () => stored.clear(),
};
const KEYNOTE = {
  slug: "keynote",
  name: "Keynote",
  elements: LIVE_OVERLAY_PRESET_LAYOUTS["ticker-only"].elements,
};
const room = applyLiveRoomMessage(
  null,
  liveSnapshot({
    viewer: { role: "operator", name: "Olga Operator" },
    overlayLayouts: [KEYNOTE],
    stage: {
      ...liveSnapshot().stage,
      question: {
        id: LIVE_QUESTION,
        text: "What about hybrid certificates?",
        authorName: null,
        authorPhotoUrl: null,
        authorAffiliation: null,
      },
      lowerThird: { ...liveSnapshot().session.credits[0]! },
    },
  }),
)!;
const sources = { preview: room, program: room, slug: "pqc-2026", roomId: "room", startAt: room.session.startAt };

const switcher = { clear: vi.fn(), disabled: false };

function Harness({ panel = 0 }: { panel?: number }) {
  const layout = useStudioLayout();
  const view = monitorPanelView(layout.panels[panel]!, sources, layout.change, switcher);
  return (
    <>
      {view.heading}
      {view.actions}
      {view.body}
    </>
  );
}

let host: HTMLElement | undefined;
beforeEach(() => {
  stored.clear();
  vi.stubGlobal("localStorage", storage);
  history.replaceState(null, "", "/#/live");
});
afterEach(() => {
  if (host) {
    void act(() => render(null, host!));
    host.remove();
    host = undefined;
  }
  vi.unstubAllGlobals();
});

const menuItem = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]')].find(
    (item) => item.textContent?.replace("✓", "").trim() === label,
  )!;

describe("studio monitor layouts", () => {
  it("shows a tile in the layout an operator picks, and keeps the choice with the panel's outputs", () => {
    host = document.createElement("div");
    document.body.append(host);
    void act(() => render(<Harness />, host!));
    const screen = () => host!.querySelector(".pk-studio-monitor__screen")!;
    expect(screen().querySelector(".pk-live-overlay__question-text")?.textContent).toBe(
      "What about hybrid certificates?",
    );
    const picker = host.querySelector<HTMLButtonElement>('button[aria-label="Layout on Preview: Full frame"]')!;
    void act(() => picker.click());
    expect(menuItem("Keynote")).toBeDefined();
    const lowerThird = () =>
      screen().querySelector<HTMLElement>('[data-overlay-element="lowerThird"] > .pk-live-overlay__surface')!.style
        .cssText;
    const fullFrame = lowerThird();
    void act(() => menuItem("Side by side").click());
    // The tile redraws in the chosen layout: the lower third moves to that layout's box.
    expect(lowerThird()).not.toBe(fullFrame);
    void act(() =>
      host!.querySelector<HTMLButtonElement>('button[aria-label="Layout on Preview: Side by side"]')!.click(),
    );
    void act(() => menuItem("Lower third only").click());
    expect(screen().querySelector(".pk-live-overlay__question-text")).toBeNull();
    expect(screen().querySelector(".pk-live-overlay__name")).not.toBeNull();
    const saved = studioLayoutsSchema.parse(JSON.parse(stored.get(STUDIO_LAYOUT_STORAGE_KEY)!)).show[0]!;
    expect(saved).toMatchObject({ outputs: ["preview"], layouts: { preview: "lower-third" } });
    void act(() =>
      host!.querySelector<HTMLButtonElement>('button[aria-label="Layout on Preview: Lower third only"]')!.click(),
    );
    void act(() => menuItem("Full frame").click());
    expect(
      studioLayoutsSchema.parse(JSON.parse(stored.get(STUDIO_LAYOUT_STORAGE_KEY)!)).show[0]!.layouts,
    ).toBeUndefined();
  });

  it("clears from each card's own header, and fills a free place with an output from the multiview", () => {
    host = document.createElement("div");
    document.body.append(host);
    // The Show workspace's second monitor, after the Transition, is the multiview: Program, Livestream, Stage display and Projector.
    void act(() => render(<Harness panel={2} />, host!));
    const tile = (label: string) =>
      [...host!.querySelectorAll<HTMLElement>(".pk-studio-monitor__tile")].find(
        (candidate) => candidate.querySelector(".pk-studio-monitor__label")?.getAttribute("title") === label,
      )!;
    const named = (scope: HTMLElement, name: string) =>
      [...scope.querySelectorAll("button")].find((button) => button.textContent?.trim() === name);
    const labeled = (scope: HTMLElement, label: string) =>
      scope.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    // Every output but the livestream clears from its own monitor; Program's clear says it can be undone.
    expect(labeled(tile("Program"), "Clear Program")?.getAttribute("title")).toBe(
      "Clear Program: remove every graphic at once. You can undo it for a few seconds.",
    );
    void act(() => labeled(tile("Program"), "Clear Program")!.click());
    expect(switcher.clear).toHaveBeenCalledWith("program");
    void act(() => labeled(tile("Projector"), "Clear Projector")!.click());
    expect(switcher.clear).toHaveBeenLastCalledWith("projector");
    expect(labeled(tile("Livestream"), "Clear Livestream")).toBeNull();
    expect(named(tile("Program"), "Put on air")).toBeUndefined();
    // The multiview's header is the one output selector; a full two-by-two grid has no free place.
    expect(host.querySelector('button[aria-label^="Output on this tile"]')).toBeNull();
    expect(host.querySelector(".pk-studio-monitor__free")).toBeNull();
    void act(() => host!.querySelector<HTMLButtonElement>('button[aria-label="Outputs on Monitors"]')!.click());
    void act(() => menuItem("Projector").click());
    expect(tile("Projector")).toBeUndefined();
    void act(() =>
      host!.querySelector<HTMLButtonElement>('button[aria-label="Add an output to this multiview"]')!.click(),
    );
    void act(() => menuItem("Preview").click());
    expect(named(tile("Preview"), "Put on air")).toBeUndefined();
    expect(studioLayoutsSchema.parse(JSON.parse(stored.get(STUDIO_LAYOUT_STORAGE_KEY)!)).show[2]!.outputs).toEqual([
      "preview",
      "program",
      "livestream",
      "stage-display",
    ]);
  });

  it("reads a saved arrangement from before layouts, and drops an unreadable layout choice rather than the arrangement", () => {
    const show = defaultStudioLayouts().show;
    stored.set(STUDIO_LAYOUT_STORAGE_KEY, JSON.stringify({ ...defaultStudioLayouts(), show }));
    expect(loadStudioLayouts(storage).show).toEqual(show);
    const odd = [{ ...show[0]!, x: 0, layouts: { preview: "Not a name!" } }, ...show.slice(1)];
    stored.set(STUDIO_LAYOUT_STORAGE_KEY, JSON.stringify({ ...defaultStudioLayouts(), show: odd }));
    const loaded = loadStudioLayouts(storage).show;
    expect(loaded[0]!.id).toBe(show[0]!.id);
    expect(loaded[0]!.layouts).toBeUndefined();
  });
});
