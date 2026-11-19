// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIVE_OVERLAY_PRESET_LAYOUTS } from "../../assets/shared/live-overlay-layout-presets";
import { DEFAULT_LIVE_SCREEN_SYNC } from "../../assets/shared/schemas/live-screen-sync";
import { EMPTY_LIVE_STAGE } from "../../assets/shared/schemas/live-session-stage";
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
  elements: LIVE_OVERLAY_PRESET_LAYOUTS.break.elements,
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
        addressedTo: null,
      },
      lowerThird: { ...liveSnapshot().session.credits[0]! },
    },
  }),
)!;
const sources = {
  preview: room,
  program: room,
  agenda: null,
  connected: true,
  slug: "pqc-2026",
  roomId: "room",
  startAt: room.session.startAt,
};

const switcher = {
  clear: vi.fn(),
  screenSync: DEFAULT_LIVE_SCREEN_SYNC,
  sync: vi.fn(),
  previewScene: vi.fn(),
  disabled: false,
};

function Harness({
  panel = 0,
  preview = room,
  program = room,
}: {
  panel?: number;
  preview?: typeof room;
  program?: typeof room | null;
}) {
  const layout = useStudioLayout();
  const view = monitorPanelView(layout.panels[panel]!, { ...sources, preview, program }, layout.change, switcher);
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
  it("loads a scene into Preview for every operator, and draws Preview and Program in their own scenes", () => {
    host = document.createElement("div");
    document.body.append(host);
    void act(() => render(<Harness />, host!));
    const screen = () => host!.querySelector(".pk-studio-monitor__screen")!;
    // A room that names no scene draws Default: the speaker's name, and no board or background.
    expect(screen().querySelector(".pk-live-overlay__name")).not.toBeNull();
    expect(screen().querySelector(".pk-live-overlay__question-text")).toBeNull();
    expect(screen().querySelector('[data-overlay-element="background"]')).toBeNull();
    const picker = host.querySelector<HTMLButtonElement>('button[aria-label="Scene in Preview: Default"]')!;
    expect(picker.textContent).toContain("Default");
    expect(picker.getAttribute("aria-haspopup")).toBe("dialog");
    void act(() => picker.click());
    // The scenes open as thumbnails, each named under its picture, the one in Preview pressed and focused.
    const popover = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(popover.querySelector("h3")?.textContent).toBe("Load a scene into Preview");
    const choices = [...popover.querySelectorAll<HTMLButtonElement>(".pk-studio-scene")];
    expect(choices.map((choice) => choice.querySelector(".pk-studio-scene__name")?.textContent)).toEqual([
      "Default",
      "Q&A",
      "Panel",
      "Break",
      "Check-in",
      "Full board",
      "Keynote",
    ]);
    expect(choices.every((choice) => choice.querySelector(".pk-studio-scene__picture .pk-live-overlay"))).toBe(true);
    expect(document.activeElement).toBe(choices[0]);
    expect(choices[0]!.getAttribute("aria-pressed")).toBe("true");
    void act(() => choices[1]!.click());
    // The choice goes to the room's shared Preview, not to this operator's monitor, and the popover closes.
    expect(switcher.previewScene).toHaveBeenLastCalledWith("questions");
    expect(stored.get(STUDIO_LAYOUT_STORAGE_KEY) ?? "").not.toContain("questions");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(picker);
    // Escape closes it too, back on its button.
    void act(() => picker.click());
    void act(() => {
      document
        .querySelector('[role="dialog"]')!
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    // Preview draws the scene it holds: Panel places the question and no lower third, which stays on, undrawn.
    const inScene = { ...room, stage: { ...room.stage, scene: "panel" } };
    void act(() => render(<Harness preview={inScene} />, host!));
    expect(screen().querySelector(".pk-live-overlay__question-text")).not.toBeNull();
    expect(screen().querySelector(".pk-live-overlay__name")).toBeNull();
    expect(host.querySelector('button[aria-label="Scene in Preview: Panel"]')).not.toBeNull();
  });

  it("marks each scene with a dot for every output showing it now, in that output's tally color", () => {
    host = document.createElement("div");
    document.body.append(host);
    // Program is on Q&A, the projector on Panel and Preview on Break; the speaker's screen draws no scene.
    const onAir = {
      ...room,
      stage: { ...room.stage, scene: "questions" },
      outputs: { ...room.outputs, projector: { ...EMPTY_LIVE_STAGE, scene: "panel" } },
    };
    const preview = { ...room, stage: { ...room.stage, scene: "break" } };
    void act(() => render(<Harness preview={preview} program={onAir} />, host!));
    const scenes = () => [...host!.querySelectorAll<HTMLButtonElement>(".pk-studio-scenes .pk-studio-scene")];
    const marked = () =>
      Object.fromEntries(
        scenes().map((scene) => [
          scene.querySelector(".pk-studio-scene__name")!.textContent,
          [...scene.querySelectorAll<HTMLElement>(".pk-studio-scene__marker")].map((marker) => [
            marker.getAttribute("aria-label"),
            marker.dataset.tally,
          ]),
        ]),
      );
    expect(marked()).toEqual({
      Default: [],
      "Q&A": [["On Program", "program"]],
      Panel: [["On Projector", "projector"]],
      Break: [["In Preview", "preview"]],
      "Check-in": [],
      "Full board": [],
      Keynote: [],
    });
    // A marker names its output as its hint too, in the studio's tooltip; it is a picture, not a control.
    const marker = scenes()[1]!.querySelector<HTMLElement>(".pk-studio-scene__marker")!;
    expect(marker.getAttribute("role")).toBe("img");
    expect(marker.dataset.tooltip ?? marker.getAttribute("title")).toBe(
      "On Program\nThis scene is on Program now. The dot has that output's color.",
    );
    expect(scenes()[1]!.querySelector("button")).toBeNull();
    // The picture stays aside for assistive technology; the scene reads as its name and where it shows.
    expect(scenes()[1]!.querySelector(".pk-studio-scene__picture")!.getAttribute("aria-hidden")).toBe("true");
    const hint = (scene: HTMLButtonElement) => scene.dataset.tooltip ?? scene.getAttribute("title");
    expect(hint(scenes()[1]!)).toBe("Q&A · on Program\nLoad it into Preview. Transition puts it on Program.");
    expect(hint(scenes()[3]!)).toBe("Break · in Preview\nTransition puts it on Program.");
    // A click on a marked scene still only loads it into Preview.
    void act(() => scenes()[1]!.click());
    expect(switcher.previewScene).toHaveBeenLastCalledWith("questions");

    // Every output on one scene: Program first, then Preview, then the room's screens in their order.
    const together = { ...onAir, outputs: { ...room.outputs, projector: { ...EMPTY_LIVE_STAGE, scene: "questions" } } };
    void act(() => render(<Harness preview={{ ...room, stage: together.stage }} program={together} />, host!));
    expect(marked()["Q&A"]).toEqual([
      ["On Program", "program"],
      ["In Preview", "preview"],
      ["On Projector", "projector"],
    ]);
    expect(hint(scenes()[1]!)).toBe("Q&A · on Program, in Preview, and on Projector\nTransition puts it on Program.");
    // Nothing on air: only Preview's scene is marked.
    void act(() => render(<Harness preview={preview} program={null} />, host!));
    expect(Object.values(marked()).flat()).toEqual([["In Preview", "preview"]]);
  });

  it("names Program's scene, and keeps a room screen's tile in the layout an operator picks", () => {
    host = document.createElement("div");
    document.body.append(host);
    void act(() => render(<Harness panel={2} />, host!));
    const tile = (label: string) =>
      [...host!.querySelectorAll<HTMLElement>(".pk-studio-monitor__tile")].find((candidate) =>
        candidate.querySelector(".pk-studio-monitor__label")?.getAttribute("title")?.includes(` · ${label}\n`),
      )!;
    expect(tile("Program").querySelector('[title^="Scene on Program: Default"]')?.textContent).toBe("Default");
    expect(tile("Program").querySelector('button[aria-label^="Scene on the"]')).toBeNull();
    const picker = tile("Projector").querySelector<HTMLButtonElement>(
      'button[aria-label="Scene on the Projector monitor: Default"]',
    )!;
    // The monitor's scene is the operator's own view: the hint says the screen itself does not change.
    expect(picker.title).toBe(
      "Scene on the Projector monitor: Default\nChoose a scene to see Projector drawn in it here. The screen itself keeps its own scene.",
    );
    void act(() => picker.click());
    void act(() => menuItem("Break").click());
    expect(studioLayoutsSchema.parse(JSON.parse(stored.get(STUDIO_LAYOUT_STORAGE_KEY)!)).show[2]!.layouts).toEqual({
      projector: "break",
    });
  });

  it("clears from each card's own header, and fills a free place with an output from the multiview", () => {
    host = document.createElement("div");
    document.body.append(host);
    // The Show workspace's second monitor, after the Transition, is the multiview: Program, Livestream, Stage display and Projector.
    void act(() => render(<Harness panel={2} />, host!));
    const tile = (label: string) =>
      [...host!.querySelectorAll<HTMLElement>(".pk-studio-monitor__tile")].find((candidate) =>
        candidate.querySelector(".pk-studio-monitor__label")?.getAttribute("title")?.includes(` · ${label}\n`),
      )!;
    const named = (scope: HTMLElement, name: string) =>
      [...scope.querySelectorAll("button")].find((button) => button.textContent?.trim() === name);
    const labeled = (scope: HTMLElement, label: string) =>
      scope.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    // Every output but the livestream clears from its own monitor. Program's clear says where it ends and that it
    // can be undone; a room screen's says it keeps its scene.
    expect(labeled(tile("Program"), "Clear Program")?.getAttribute("title")).toBe(
      "Clear Program\nTake everything off air and go back to the Default scene. You can undo it for a few seconds.",
    );
    expect(labeled(tile("Projector"), "Clear Projector")?.getAttribute("title")).toBe(
      "Clear Projector\nTake everything off Projector. It keeps its scene.",
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

  it("syncs the projector and the stage display with Program from their own headers", () => {
    host = document.createElement("div");
    document.body.append(host);
    void act(() => render(<Harness panel={2} />, host!));
    const sync = (label: string) =>
      host!.querySelector<HTMLButtonElement>(`button[aria-label="Sync ${label} with Program"]`);
    expect(sync("Program")).toBeNull();
    expect(sync("Livestream")).toBeNull();
    const projector = sync("Projector")!;
    expect(projector.getAttribute("aria-pressed")).toBe("true");
    expect(projector.title).toMatch(/^Sync with Program: on\nWhat you change on Program changes here too/);
    void act(() => projector.click());
    expect(switcher.sync).toHaveBeenLastCalledWith("projector", false);
    expect(sync("Stage display")!.getAttribute("aria-pressed")).toBe("true");
  });

  it("counts each output's sources as a screen and a number, amber only when nothing shows Program", () => {
    host = document.createElement("div");
    document.body.append(host);
    void act(() => render(<Harness panel={2} />, host!));
    const counts = () =>
      [...host!.querySelectorAll<HTMLElement>(".pk-studio-monitor__sources")].map((count) => ({
        text: count.textContent,
        warn: count.dataset.tone === "warn",
        name: count.getAttribute("aria-label")!,
      }));
    const [program, ...others] = counts();
    expect(program).toEqual({ text: "0", warn: true, name: expect.stringMatching(/^Nothing shows Program now/) });
    expect(others.every((count) => count.text === "0" && !count.warn)).toBe(true);
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
