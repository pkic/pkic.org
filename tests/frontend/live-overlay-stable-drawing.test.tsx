// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LiveOverlayLayoutElements } from "../../assets/shared/schemas/live-overlay-layout";
import { EMPTY_LIVE_STAGE, type LiveStage } from "../../assets/shared/schemas/live-session-room";
import { LiveOverlayPresentation } from "../../assets/ts/live-session/LiveOverlayPresentation";
import type { LiveRoomState } from "../../assets/ts/live-session/live-room-state";
import { StudioOutputScreen } from "../../assets/ts/member-flows/portal/sections/events/detail/live/studio/MonitorPanel";
import { SCENE_SWITCH_CLOSE, SCENE_SWITCH_WIDE } from "../../assets/ts/ui/preview/sections-live-scene-switch";
import { sampleOverlayRoom } from "../../assets/ts/member-flows/portal/sections/events/detail/settings/live-layouts/overlay-layout-sample";

const SAMPLE = sampleOverlayRoom(Date.parse("2026-11-30T10:00:00.000Z"));
const BURST = { sequence: 1, counts: { applause: 2, love: 1 }, people: { applause: 2, love: 1 } };

/** The sample room with only the listed graphics on, drawing one of the two scenes. */
function room(sceneSlug: string, ...on: (keyof LiveStage)[]): LiveRoomState {
  const stage: Record<string, unknown> = { ...EMPTY_LIVE_STAGE, scene: sceneSlug };
  for (const key of on) stage[key] = SAMPLE.stage[key];
  return { ...SAMPLE, stage: stage as LiveStage, overlayLayouts: [SCENE_SWITCH_WIDE, SCENE_SWITCH_CLOSE], burst: null };
}
const ON = ["ticker", "reactions", "lowerThird", "timerGraphics", "schedule", "topQuestions"] as const;

let host: HTMLElement | undefined;
afterEach(async () => {
  if (!host) return;
  await act(() => render(null, host!));
  host.remove();
  host = undefined;
  vi.useRealTimers();
});

/** Lets the fake clock run on, with every timer and render it sets off. */
const wait = (milliseconds: number) =>
  act(() => {
    vi.advanceTimersByTime(milliseconds);
  });
const layer = (element: string) => host!.querySelector<HTMLElement>(`[data-overlay-element="${element}"]`);
const order = (element: string) => Number(layer(element)!.style.getPropertyValue("--overlay-order"));
const surface = (element: string) => layer(element)!.querySelector<HTMLElement>(".pk-live-overlay__surface")!;

/** Every node added to or taken out of the picture from now on, a move counting as both. */
function watchPicture() {
  const added: Node[] = [];
  const removed: Node[] = [];
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      added.push(...record.addedNodes);
      removed.push(...record.removedNodes);
    }
  });
  observer.observe(host!.querySelector(".pk-live-overlay__frame")!, { childList: true, subtree: true });
  return {
    added,
    removed,
    settle: () => {
      for (const record of observer.takeRecords()) {
        added.push(...record.addedNodes);
        removed.push(...record.removedNodes);
      }
      observer.disconnect();
    },
  };
}

describe("a scene switch on an output", () => {
  async function draw(state: LiveRoomState) {
    host ??= document.body.appendChild(document.createElement("div"));
    await act(() => render(<LiveOverlayPresentation view="program" projection={state} broadcast />, host!));
  }

  it("keeps every graphic that stays on in its own node, restacked and moved, never taken out or put back", async () => {
    await draw(room("wide", ...ON));
    await draw({ ...room("wide", ...ON), burst: BURST });
    const kept = ["ticker", "reactions", "lowerThird", "timer"];
    const before = new Map(kept.map((element) => [element, layer(element)!]));
    const track = host!.querySelector(".pk-live-ticker__track")!;
    const floats = [...host!.querySelectorAll(".pk-live-overlay__reaction")];
    expect(floats).toHaveLength(3);
    // Wide stacks reactions over the ticker; Close turns that around.
    expect(order("reactions")).toBeGreaterThan(order("ticker"));
    const stacked = Object.fromEntries(kept.map((element) => [element, order(element)]));
    const placed = surface("ticker").style.getPropertyValue("--overlay-dy");

    const watch = watchPicture();
    await draw({ ...room("close", ...ON), burst: BURST });
    watch.settle();

    for (const element of kept) {
      expect(layer(element), element).toBe(before.get(element));
      expect(before.get(element)!.isConnected, element).toBe(true);
      expect(watch.removed, element).not.toContain(before.get(element));
      expect(watch.added, element).not.toContain(before.get(element));
    }
    // The ticker's track and the reactions already floating are the same nodes, so their motion runs on.
    expect(host!.querySelector(".pk-live-ticker__track")).toBe(track);
    expect([...host!.querySelectorAll(".pk-live-overlay__reaction")]).toEqual(floats);
    expect([...watch.removed, ...watch.added]).not.toContain(track);
    for (const float of floats) expect([...watch.removed, ...watch.added]).not.toContain(float);
    // The stack follows the new scene, and the ticker sits in its new box.
    expect(order("ticker")).toBeGreaterThan(order("reactions"));
    expect(Object.fromEntries(kept.map((element) => [element, order(element)]))).not.toEqual(stacked);
    expect(surface("ticker").style.getPropertyValue("--overlay-dy")).not.toBe(placed);
  });

  it("takes out only the graphic the new scene leaves out, and puts in only the ones it adds", async () => {
    await draw(room("wide", ...ON));
    const upNext = layer("schedule")!;
    expect(layer("topQuestions")).toBeNull();
    const watch = watchPicture();
    await draw(room("close", ...ON));
    watch.settle();
    expect(layer("schedule")).toBeNull();
    expect(layer("topQuestions")).not.toBeNull();
    const layers = (nodes: Node[]) =>
      nodes.filter((node) => node instanceof HTMLElement && node.dataset.overlayElement !== undefined);
    expect(layers(watch.removed)).toEqual([upNext]);
    expect(layers(watch.added)).toEqual([layer("background"), layer("topQuestions")]);
  });

  it("moves a graphic to its new box only while the scene changes, never as it comes on", async () => {
    vi.useFakeTimers();
    const moving = (element: string) => surface(element).hasAttribute("data-moving");
    await draw(room("wide", "ticker"));
    expect(moving("ticker")).toBe(false);
    // Its layer waits for a name; a change of content in the same scene places a graphic at once.
    expect(moving("lowerThird")).toBe(false);
    await draw(room("close", "ticker", "lowerThird", "timerGraphics"));
    expect(moving("ticker")).toBe(true);
    // The lower third and the timer come on with the switch: each enters in its box, as it always does.
    expect(moving("lowerThird")).toBe(false);
    expect(moving("timer")).toBe(false);
    // Once the graphics have moved, a box that changes for another reason is placed at once again.
    await wait(1000);
    expect(moving("ticker")).toBe(false);
    await draw(room("wide", "ticker", "lowerThird", "timerGraphics"));
    expect(["ticker", "timer"].map(moving)).toEqual([true, true]);
    // Back before the move ends: it keeps moving, to where it came from.
    await wait(200);
    await draw(room("close", "ticker", "lowerThird", "timerGraphics"));
    await wait(500);
    expect(moving("ticker")).toBe(true);
    await wait(200);
    expect(moving("ticker")).toBe(false);
  });

  it("moves a graphic whose box keeps its size, and cuts one whose box changes size", async () => {
    vi.useFakeTimers();
    const moving = (element: string) => surface(element).hasAttribute("data-moving");
    const size = (scene: typeof SCENE_SWITCH_WIDE, element: "ticker" | "timer" | "reactions" | "lowerThird") => [
      scene.elements[element].w,
      scene.elements[element].h,
    ];
    const on = ["ticker", "reactions", "lowerThird", "timerGraphics"] as const;
    await draw(room("wide", ...on));
    await draw(room("close", ...on));
    // Same size, another position: each moves there.
    for (const element of ["ticker", "timer", "reactions"] as const) {
      expect(size(SCENE_SWITCH_CLOSE, element), element).toEqual(size(SCENE_SWITCH_WIDE, element));
      expect(SCENE_SWITCH_CLOSE.elements[element], element).not.toEqual(SCENE_SWITCH_WIDE.elements[element]);
      expect(moving(element), element).toBe(true);
    }
    // Another size: it is set for the new box at once, with no frame of it inside the old one.
    expect(size(SCENE_SWITCH_CLOSE, "lowerThird")).not.toEqual(size(SCENE_SWITCH_WIDE, "lowerThird"));
    expect(moving("lowerThird")).toBe(false);
    // Back while the others still move: its size changes again, so it cuts again.
    await wait(200);
    await draw(room("wide", ...on));
    expect(["ticker", "timer", "reactions", "lowerThird"].map(moving)).toEqual([true, true, true, false]);
    // A later switch that keeps its size moves it like any other graphic.
    await wait(1000);
    const sameSize = { ...SCENE_SWITCH_WIDE.elements.lowerThird, x: 0.2 };
    const shifted = {
      slug: "shifted",
      name: "Shifted",
      elements: { ...SCENE_SWITCH_WIDE.elements, lowerThird: sameSize },
    };
    const state = room("shifted", ...on);
    await draw({ ...state, overlayLayouts: [...state.overlayLayouts, shifted] });
    expect(moving("lowerThird")).toBe(true);
  });

  it("never moves a box the scene editor drags, which is no scene change", async () => {
    const drawDraft = (elements: LiveOverlayLayoutElements) =>
      act(() =>
        render(
          <LiveOverlayPresentation view="program" elements={elements} projection={room("wide", "ticker")} />,
          host!,
        ),
      );
    host = document.body.appendChild(document.createElement("div"));
    await drawDraft(SCENE_SWITCH_WIDE.elements);
    const ticker = layer("ticker")!;
    await drawDraft(SCENE_SWITCH_CLOSE.elements);
    expect(layer("ticker")).toBe(ticker);
    expect(surface("ticker").hasAttribute("data-moving")).toBe(false);
  });
});

describe("a scene switch on a studio monitor", () => {
  const sources = (state: LiveRoomState) => ({
    preview: state,
    program: state,
    agenda: null,
    connected: true,
    slug: "pqc-2026",
    roomId: "room",
    startAt: state.session.startAt,
  });
  async function draw(state: LiveRoomState) {
    host ??= document.body.appendChild(document.createElement("div"));
    await act(() => render(<StudioOutputScreen output="preview" layout={null} sources={sources(state)} />, host!));
  }

  it("keeps the picture and the graphics that stay on", async () => {
    await draw(room("wide", ...ON));
    const frame = host!.querySelector(".pk-live-overlay__frame")!;
    const kept = ["ticker", "reactions", "lowerThird", "timer"].map((element) => layer(element)!);
    const watch = watchPicture();
    await draw(room("close", ...ON));
    watch.settle();
    expect(host!.querySelector(".pk-live-overlay__frame")).toBe(frame);
    expect(["ticker", "reactions", "lowerThird", "timer"].map(layer)).toEqual(kept);
    for (const node of kept) expect([...watch.removed, ...watch.added]).not.toContain(node);
    expect(order("ticker")).toBeGreaterThan(order("reactions"));
  });

  it("keeps the picture when a scene brings the first graphic on", async () => {
    await draw({ ...room("wide"), stage: { ...EMPTY_LIVE_STAGE } });
    const frame = host!.querySelector(".pk-live-overlay__frame")!;
    expect(host!.textContent).toContain("Nothing in preview");
    await draw(room("close", "ticker"));
    expect(host!.querySelector(".pk-live-overlay__frame")).toBe(frame);
    expect(host!.textContent).not.toContain("Nothing in preview");
  });
});
