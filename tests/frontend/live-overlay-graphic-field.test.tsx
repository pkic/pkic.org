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
const marks = (host: HTMLElement) => host.querySelectorAll(".pk-live-board__watermark");

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
    // Board right and Board left place it in their column; no board is on it here.
    for (const layout of ["questions", "check-in", "full-board"]) {
      const host = draw({ view: "program", layout, projection: room("lowerThird") });
      expect(fields(host), layout).toHaveLength(1);
      expect(marks(host), layout).toHaveLength(1);
    }
    // With everything on at once, every scene still draws at most one background and one logo.
    for (const layout of LIVE_OVERLAY_PRESETS) {
      const host = draw({ view: "program", layout, projection: EVERYTHING_ON });
      const included = LIVE_OVERLAY_PRESET_LAYOUTS[layout].elements.background.visible ? 1 : 0;
      expect(fields(host), layout).toHaveLength(included);
      expect(marks(host), layout).toHaveLength(included);
      // Branding is the production's: no scene draws a logo.
      expect(host.querySelector(".pk-live-board img"), layout).toBeNull();
    }
  });

  it("never draws a graphic the scene does not include, whatever the output has on", () => {
    for (const layout of LIVE_OVERLAY_PRESETS) {
      const { elements } = LIVE_OVERLAY_PRESET_LAYOUTS[layout];
      const host = draw({ view: "program", layout, projection: EVERYTHING_ON });
      for (const element of drawn(host))
        expect(elements[element as keyof typeof elements].visible, `${layout}: ${element}`).toBe(true);
    }
    // Break places no board, no check-in code and no lower third: they stay on the output, undrawn, for a later scene.
    const pause = drawn(draw({ view: "program", layout: "break", projection: EVERYTHING_ON }));
    expect(pause).toEqual(expect.arrayContaining(["schedule", "timer", "ticker", "reactions"]));
    for (const left of [
      "question",
      "poll",
      "panelists",
      "topQuestions",
      "chat",
      "checkIn",
      "lowerThird",
      "background",
      "qrCode",
    ])
      expect(pause, left).not.toContain(left);
  });

  it("includes every switchable graphic in Default, boards too, and draws no background of its own", () => {
    // Nothing comes on by itself: what the output has on draws, over the camera and with no field behind it.
    const cards = draw({
      view: "program",
      layout: "default",
      projection: room("schedule", "checkIn", "timerGraphics"),
    });
    expect([...new Set(drawn(cards))]).toEqual(expect.arrayContaining(["schedule", "checkIn", "timer"]));
    const board = draw({ view: "program", layout: "default", projection: room("question") });
    expect(layer(board, "question")).not.toBeNull();
    expect(layer(board, "background")).toBeNull();
    expect(fields(board)).toHaveLength(0);
    // A board covered by one in front of it is left out; the background and the QR code are never drawn here.
    const everything = draw({ view: "program", layout: "default", projection: EVERYTHING_ON });
    expect(drawn(everything)).not.toContain("question");
    expect(drawn(everything)).toEqual(expect.arrayContaining(["poll", "timer", "ticker", "reactions"]));
    for (const left of ["background", "qrCode"]) expect(layer(everything, left), left).toBeNull();
    expect(everything.querySelector(".pk-live-board--ground")).toBeNull();
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

  it("draws the question and panelists as one board on the background, clear of the timer", () => {
    const host = draw({
      view: "program",
      layout: "full-board",
      projection: room("question", "panelists", "timerGraphics"),
    });
    expect(fields(host)).toHaveLength(1);
    expect(marks(host)).toHaveLength(1);
    // The background has nothing to keep clear of the timer; the board on it does.
    expect(layer(host, "background")?.hasAttribute("data-timer-clearance")).toBe(false);
    expect(layer(host, "panelists")?.hasAttribute("data-timer-clearance")).toBe(true);
    expect(drawn(host).filter((element) => element === "panelists" || element === "question")).toEqual(["panelists"]);
  });

  it("hides the joined question and panelists board behind a poll in front of it", () => {
    const host = draw({ view: "program", layout: "full-board", projection: room("question", "panelists", "poll") });
    const boards = drawn(host).filter((element) => ["question", "panelists", "poll"].includes(element!));
    expect(boards).toEqual(["poll"]);
    expect(fields(host)).toHaveLength(1);
  });

  it("keeps the joined question and panelists board in front of the top questions in the same spot", () => {
    const host = draw({
      view: "program",
      layout: "questions",
      projection: room("question", "panelists", "topQuestions"),
    });
    const boards = drawn(host).filter((element) => ["question", "panelists", "topQuestions"].includes(element!));
    expect(boards).toEqual(["panelists"]);
    expect(fields(host)).toHaveLength(1);
  });

  it("draws Up next on the background it sits inside, without a card of its own, over the whole frame in Full board", () => {
    const host = draw({ view: "program", layout: "full-board", projection: room("schedule") });
    expect(drawn(host)).toEqual(["background", "schedule"]);
    expect(layer(host, "schedule")?.hasAttribute("data-on-ground")).toBe(true);
    const surface = layer(host, "schedule")!.querySelector<HTMLElement>(".pk-live-overlay__surface")!;
    expect(surface.style.getPropertyValue("--overlay-scale")).toBe("1");
  });

  it("keeps Up next's card outside a background, and the check-in code's card everywhere", () => {
    // Break and Default have no background, so Up next keeps its card there.
    for (const layout of ["break", "default"]) {
      const host = draw({ view: "program", layout, projection: room("schedule", "checkIn") });
      expect(layer(host, "schedule"), layout).not.toBeNull();
      expect(layer(host, "schedule")?.hasAttribute("data-on-ground"), layout).toBe(false);
    }
    // Up next in Board left sits inside the column's background and drops its card.
    const column = draw({ view: "program", layout: "check-in", projection: room("schedule") });
    expect(layer(column, "schedule")?.hasAttribute("data-on-ground")).toBe(true);
    // The check-in code keeps its card on Board left's background, as it always did.
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
    expect(board.querySelector(".pk-live-board__watermark")).toBeNull();
    expect(fields(host)).toHaveLength(1);
    expect(marks(host)).toHaveLength(1);
  });

  it("no longer reads a board's old field flag: only the background graphic draws a field", () => {
    const flagged = { ...LIVE_OVERLAY_STANDARD_ELEMENTS.topQuestions, background: true };
    const elements = { ...LIVE_OVERLAY_STANDARD_ELEMENTS, topQuestions: flagged };
    const host = draw({ view: "program", elements, projection: room("topQuestions") });
    expect(layer(host, "topQuestions")).not.toBeNull();
    expect(fields(host)).toHaveLength(0);
    expect(marks(host)).toHaveLength(0);
  });

  it("draws no field on the stage display", () => {
    expect(fields(draw({ view: "stage-display", layout: "questions", projection: room("question") }))).toHaveLength(0);
  });
});
