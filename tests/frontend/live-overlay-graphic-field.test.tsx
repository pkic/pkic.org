// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import {
  LIVE_OVERLAY_PRESET_LAYOUTS,
  LIVE_OVERLAY_STANDARD_ELEMENTS,
} from "../../assets/shared/live-overlay-layout-presets";
import { LIVE_OVERLAY_PRESETS } from "../../assets/shared/schemas/live-overlay-layout";
import { EMPTY_LIVE_STAGE, type LiveStage } from "../../assets/shared/schemas/live-session-room";
import { LiveOverlayPresentation } from "../../assets/ts/live-session/LiveOverlayPresentation";
import type { LiveRoomState } from "../../assets/ts/live-session/live-room-state";
import { sampleOverlayRoom } from "../../assets/ts/member-flows/portal/sections/events/detail/settings/live-layouts/overlay-layout-sample";

const hosts: HTMLElement[] = [];
const SAMPLE = sampleOverlayRoom(Date.parse("2026-11-30T10:00:00.000Z"));

/** The sample room with only the listed graphics on air. */
function room(...on: (keyof LiveStage)[]): LiveRoomState {
  const stage: Record<string, unknown> = { ...EMPTY_LIVE_STAGE };
  for (const key of on) stage[key] = SAMPLE.stage[key];
  return { ...SAMPLE, stage: stage as LiveStage };
}

function draw(props: Parameters<typeof LiveOverlayPresentation>[0]) {
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  void act(() => render(<LiveOverlayPresentation {...props} />, host));
  return host;
}

const fields = (host: HTMLElement) =>
  host.querySelectorAll('[data-overlay-element="background"] .pk-live-board--ground');
const layer = (host: HTMLElement, element: string) =>
  host.querySelector<HTMLElement>(`[data-overlay-element="${element}"]`);
const drawn = (host: HTMLElement) =>
  [...host.querySelectorAll<HTMLElement>("[data-overlay-element]")].map((each) => each.dataset.overlayElement);

afterEach(() => {
  for (const host of hosts.splice(0)) {
    render(null, host);
    host.remove();
  }
});

/** Every graphic an output can have on, all on at once. */
const EVERYTHING_ON = room(...(Object.keys(EMPTY_LIVE_STAGE) as (keyof LiveStage)[]));
const logos = (host: HTMLElement) => host.querySelectorAll(".pk-live-board__logo");

describe("the scene's background on an output", () => {
  it("draws a blank frame for a cleared output in the Default scene, and only the background in a scene that includes it", () => {
    for (const layout of LIVE_OVERLAY_PRESETS) {
      const host = draw({ view: "program", layout, projection: room() });
      const included = LIVE_OVERLAY_PRESET_LAYOUTS[layout].elements.background.visible;
      // A scene's lower third stays mounted, empty, so it can animate in; nothing else is drawn.
      expect(
        drawn(host).filter((element) => element !== "lowerThird"),
        layout,
      ).toEqual(included ? ["background"] : []);
      expect(host.textContent, layout).toBe("");
    }
    // What Clear leaves on Preview or Program: no scene named, so Default, with nothing on.
    const cleared = draw({ view: "program", projection: room() });
    expect(drawn(cleared).filter((element) => element !== "lowerThird")).toEqual([]);
    expect(cleared.querySelector("svg, img")).toBeNull();
  });

  it("draws the background whenever its scene is on, with or without a board on it, and never twice", () => {
    // Q&A and Check-in place it in their column; no board is on it here.
    for (const layout of ["questions", "check-in", "panel", "full-board"]) {
      const host = draw({ view: "program", layout, projection: room("lowerThird") });
      expect(fields(host), layout).toHaveLength(1);
      expect(logos(host), layout).toHaveLength(1);
    }
    // With everything on at once, every scene still draws at most one background and one logo.
    for (const layout of LIVE_OVERLAY_PRESETS) {
      const host = draw({ view: "program", layout, projection: EVERYTHING_ON });
      const included = LIVE_OVERLAY_PRESET_LAYOUTS[layout].elements.background.visible ? 1 : 0;
      expect(fields(host), layout).toHaveLength(included);
      expect(logos(host), layout).toHaveLength(included);
      expect(host.querySelectorAll(".pk-live-board__watermark"), layout).toHaveLength(included);
    }
  });

  it("never draws a graphic the scene does not include, whatever the output has on", () => {
    for (const layout of LIVE_OVERLAY_PRESETS) {
      const { elements } = LIVE_OVERLAY_PRESET_LAYOUTS[layout];
      const host = draw({ view: "program", layout, projection: EVERYTHING_ON });
      for (const element of drawn(host))
        expect(elements[element as keyof typeof elements].visible, `${layout}: ${element}`).toBe(true);
    }
    // Break places no board and no check-in code: they stay on the output, undrawn, for a later scene.
    const pause = drawn(draw({ view: "program", layout: "break", projection: EVERYTHING_ON }));
    expect(pause).toEqual(expect.arrayContaining(["schedule", "lowerThird", "timer", "ticker", "reactions"]));
    for (const left of ["question", "poll", "panelists", "topQuestions", "chat", "checkIn", "background", "qrCode"])
      expect(pause, left).not.toContain(left);
  });

  it("never draws a board in Default, only the graphics that sit over the picture", () => {
    const host = draw({ view: "program", layout: "default", projection: EVERYTHING_ON });
    expect([...new Set(drawn(host))]).toEqual(["schedule", "checkIn", "lowerThird", "timer", "ticker", "reactions"]);
    for (const board of ["question", "poll", "panelists", "topQuestions", "chat", "background"])
      expect(layer(host, board), board).toBeNull();
    expect(host.querySelector(".pk-live-board")).toBeNull();
  });

  it("shows the front one of two boards in the same spot, on the one background", () => {
    const shared = (host: HTMLElement) =>
      drawn(host).filter((element) => ["question", "topQuestions", "poll"].includes(element!));
    const host = draw({ view: "program", layout: "questions", projection: room("question", "topQuestions", "poll") });
    expect(shared(host)).toEqual(["poll"]);
    expect(fields(host)).toHaveLength(1);
    // A question put on air takes the spot from the top questions, which are back once it goes off.
    expect(
      shared(draw({ view: "program", layout: "questions", projection: room("question", "topQuestions") })),
    ).toEqual(["question"]);
    expect(shared(draw({ view: "program", layout: "questions", projection: room("topQuestions") }))).toEqual([
      "topQuestions",
    ]);
  });

  it("draws the panel's question and panelists as one board on the background, its logo beside the timer", () => {
    const host = draw({ view: "program", layout: "panel", projection: room("question", "panelists", "timerGraphics") });
    expect(fields(host)).toHaveLength(1);
    expect(logos(host)).toHaveLength(1);
    expect(layer(host, "background")?.hasAttribute("data-logo-covered")).toBe(true);
    expect(drawn(host).filter((element) => element === "panelists" || element === "question")).toEqual(["panelists"]);
  });

  it("draws Up next on the background it sits inside, without a card of its own, over the whole frame in Full board", () => {
    const host = draw({ view: "program", layout: "full-board", projection: room("schedule") });
    expect(drawn(host)).toEqual(["background", "schedule"]);
    expect(layer(host, "schedule")?.hasAttribute("data-on-ground")).toBe(true);
    const surface = layer(host, "schedule")!.querySelector<HTMLElement>(".pk-live-overlay__surface")!;
    expect(surface.style.getPropertyValue("--overlay-scale")).toBe("1");
  });

  it("keeps Up next's card outside a background, and the check-in code's card everywhere", () => {
    // Break and Default have no background; in Check-in Up next sits beside the column, over the camera.
    for (const layout of ["break", "default", "check-in"]) {
      const host = draw({ view: "program", layout, projection: room("schedule", "checkIn") });
      expect(layer(host, "schedule"), layout).not.toBeNull();
      expect(layer(host, "schedule")?.hasAttribute("data-on-ground"), layout).toBe(false);
    }
    // The check-in code keeps its card on Check-in's background, as it always did.
    const code = draw({ view: "program", layout: "check-in", projection: room("checkIn") });
    expect(layer(code, "checkIn")).not.toBeNull();
    expect(code.querySelector("[data-on-ground]")).toBeNull();
  });

  it("draws a board outside the background with its content and no field, mark or logo of its own", () => {
    const column = { ...LIVE_OVERLAY_STANDARD_ELEMENTS.background, visible: true, x: 0.6, y: 0, w: 0.4, h: 1 };
    const elements = { ...LIVE_OVERLAY_STANDARD_ELEMENTS, background: column };
    const host = draw({ view: "program", elements, projection: room("question") });
    const board = layer(host, "question")!.querySelector(".pk-live-board")!;
    expect(board.textContent).not.toBe("");
    expect(board.classList.contains("pk-live-board--ground")).toBe(false);
    expect(board.querySelector(".pk-live-board__logo, .pk-live-board__watermark")).toBeNull();
    expect(fields(host)).toHaveLength(1);
    expect(logos(host)).toHaveLength(1);
  });

  it("no longer reads a board's old field flag: only the background graphic draws a field", () => {
    const flagged = { ...LIVE_OVERLAY_STANDARD_ELEMENTS.topQuestions, background: true };
    const elements = { ...LIVE_OVERLAY_STANDARD_ELEMENTS, topQuestions: flagged };
    const host = draw({ view: "program", elements, projection: room("topQuestions") });
    expect(layer(host, "topQuestions")).not.toBeNull();
    expect(fields(host)).toHaveLength(0);
    expect(logos(host)).toHaveLength(0);
  });

  it("draws no field on the stage display", () => {
    expect(fields(draw({ view: "stage-display", layout: "questions", projection: room("question") }))).toHaveLength(0);
  });
});
