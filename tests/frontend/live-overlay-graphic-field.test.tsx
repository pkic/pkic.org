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
import { overlayBoxPixels } from "../../assets/shared/live-overlay-geometry";
import { liveBoardInset, liveGroundShowsMark } from "../../assets/ts/live-session/LiveBoard";
import { LiveOverlayPresentation } from "../../assets/ts/live-session/LiveOverlayPresentation";
import { liveListBox } from "../../assets/ts/live-session/live-overlay-fields";
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
/** Where a graphic sits on the frame, as its surface's style places it. */
const box = (host: HTMLElement, element: string) =>
  layer(host, element)!.querySelector<HTMLElement>(".pk-live-overlay__surface")!.getAttribute("style");
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
      // A background that waits for a board stays out of a cleared output.
      const { visible, withBoardOnly } = LIVE_OVERLAY_PRESET_LAYOUTS[layout].elements.background;
      const included = visible && !withBoardOnly;
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
    // Board right and Board left place it in their column; no board is on it here. Only the whole frame's
    // background carries the faint mark: a panel in a column goes without, so several panels never repeat it.
    for (const [layout, mark] of [
      ["questions", 0],
      ["check-in", 0],
      ["full-board", 1],
    ] as const) {
      const host = draw({ view: "program", layout, projection: room("lowerThird") });
      expect(fields(host), layout).toHaveLength(1);
      expect(marks(host), layout).toHaveLength(mark);
    }
    // With everything on at once, every scene still draws at most one background and one mark.
    for (const layout of LIVE_OVERLAY_PRESETS) {
      const host = draw({ view: "program", layout, projection: EVERYTHING_ON });
      const ground = LIVE_OVERLAY_PRESET_LAYOUTS[layout].elements.background;
      const included = ground.visible ? 1 : 0;
      expect(fields(host), layout).toHaveLength(included);
      expect(marks(host), layout).toHaveLength(included && liveGroundShowsMark(overlayBoxPixels(ground)) ? 1 : 0);
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
    // Break's column is one spot where Up next, the chat and the top questions take turns: one of them shows.
    // It places no other board, no check-in code and no lower third: they stay on the output, undrawn, for a later scene.
    const pause = drawn(draw({ view: "program", layout: "break", projection: EVERYTHING_ON }));
    expect(pause).toEqual(expect.arrayContaining(["timer", "ticker", "reactions"]));
    expect(pause.filter((element) => element && ["schedule", "chat", "topQuestions"].includes(element))).toHaveLength(
      1,
    );
    for (const left of ["question", "poll", "panelists", "checkIn", "lowerThird", "background", "qrCode"])
      expect(pause, left).not.toContain(left);
  });

  it("includes every switchable graphic in Default, boards too, with the background only under a whole-frame board", () => {
    // Nothing comes on by itself: the cards in their corners draw over the camera on their own plates.
    const cards = draw({
      view: "program",
      layout: "default",
      projection: room("schedule", "checkIn", "timerGraphics"),
    });
    expect([...new Set(drawn(cards))]).toEqual(expect.arrayContaining(["schedule", "checkIn", "timer"]));
    expect(fields(cards)).toHaveLength(0);
    expect(layer(cards, "schedule")!.hasAttribute("data-on-ground")).toBe(false);
    // A question over the whole frame brings the background with it, so it never reads bare on the camera.
    const board = draw({ view: "program", layout: "default", projection: room("question") });
    expect(layer(board, "question")).not.toBeNull();
    expect(fields(board)).toHaveLength(1);
    // A board covered by one in front of it is left out; the QR code is never drawn here.
    const everything = draw({ view: "program", layout: "default", projection: EVERYTHING_ON });
    expect(drawn(everything)).not.toContain("question");
    expect(drawn(everything)).toEqual(expect.arrayContaining(["poll", "timer", "ticker", "reactions", "background"]));
    expect(layer(everything, "qrCode")).toBeNull();
    expect(fields(everything)).toHaveLength(1);
  });

  it("brings a waiting background on only under the board on air, in that board's box", () => {
    const slides = { x: 0.3, y: 0.0444, w: 0.6667, h: 0.6667, horizontal: "center", vertical: "middle" } as const;
    const camera = LIVE_OVERLAY_PRESET_LAYOUTS.default.elements;
    const talk = {
      ...camera,
      background: { ...camera.background, ...slides, visible: true, withBoardOnly: true },
      question: { ...camera.question, ...slides },
      poll: { ...camera.poll, ...slides },
    };
    // Nothing on, or only a card that sits in a corner: the slides stay clear.
    expect(fields(draw({ view: "program", elements: talk, projection: room() }))).toHaveLength(0);
    expect(fields(draw({ view: "program", elements: talk, projection: room("schedule") }))).toHaveLength(0);
    // A question or a poll over the slides comes on the glass, also while the ticker moves it clear.
    for (const board of ["question", "poll"] as const) {
      const host = draw({ view: "program", elements: talk, projection: room(board, "ticker") });
      expect(fields(host), board).toHaveLength(1);
      expect(layer(host, board), board).not.toBeNull();
    }
    // The background sits in the box of the board on air: in the band under a question, in the slides' place under a poll.
    const band = { x: 0.0333, y: 0.7407, w: 0.9333, h: 0.2148, horizontal: "center", vertical: "bottom" } as const;
    const split = { ...talk, question: { ...camera.question, ...band } };
    for (const board of ["question", "poll"] as const) {
      const host = draw({ view: "program", elements: split, projection: room(board) });
      expect(fields(host), board).toHaveLength(1);
      expect(box(host, board), board).toMatch(/\S/);
      expect(box(host, "background"), board).toBe(box(host, board));
    }
    // A question covered by a poll over the whole frame: the background goes under the poll, not on the slides.
    const covering = { ...talk, poll: camera.poll };
    const host = draw({ view: "program", elements: covering, projection: room("question", "poll") });
    expect(box(host, "background")).toBe(box(host, "poll"));
    // A list grown into its empty partner's half: the background takes the whole column it draws in.
    const top = { x: 0.6, y: 0.05, w: 0.35, h: 0.45, horizontal: "left", vertical: "top" } as const;
    const bottom = { ...top, y: 0.5 };
    const column = {
      ...talk,
      topQuestions: { ...camera.topQuestions, ...top, visible: true },
      chat: { ...camera.chat, ...bottom, visible: true },
    };
    const alone = draw({ view: "program", elements: column, projection: room("chatFeed") });
    expect(fields(alone)).toHaveLength(1);
    expect(box(alone, "background")).toBe(box(alone, "chat"));
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

  it("keeps a board's lines in the frame's safe margin, and only a panel's inset well inside the frame", () => {
    // The whole frame, or a box without a position: the broadcast safe margin.
    expect(liveBoardInset({ x: 0, y: 0, width: 1920, height: 1080 })).toEqual({ inline: 96, block: 64 });
    expect(liveBoardInset({ width: 1040, height: 640 })).toEqual({ inline: 96, block: 64 });
    // A column 48 from the frame's edge keeps the rest of the safe margin on both sides, never lopsided.
    expect(liveBoardInset({ x: 48, y: 48, width: 640, height: 858 })).toEqual({ inline: 48, block: 32 });
    // A panel well inside the frame keeps only the panel's own inset.
    expect(liveBoardInset({ x: 720, y: 728, width: 840, height: 178 })).toEqual({ inline: 40, block: 32 });
  });

  it("draws Up next on a panel at its box's own size, headed like a board, without a card", () => {
    const strip = { ...LIVE_OVERLAY_STANDARD_ELEMENTS.background, visible: true, x: 0.375, y: 0.674, w: 0.6, h: 0.165 };
    const upNext = {
      ...LIVE_OVERLAY_STANDARD_ELEMENTS.schedule,
      visible: true,
      x: 0.375,
      y: 0.674,
      w: 0.4375,
      h: 0.165,
    };
    const elements = { ...LIVE_OVERLAY_STANDARD_ELEMENTS, background: strip, schedule: upNext };
    const host = draw({ view: "program", elements, projection: room("schedule") });
    const graphic = layer(host, "schedule")!.querySelector<HTMLElement>(".pk-live-schedule")!;
    expect(graphic.dataset).toMatchObject({ onGround: "", arrangement: "rows" });
    expect(marks(host)).toHaveLength(0);
  });

  it("keeps Up next's and the check-in code's cards outside a background, and drops them inside one", () => {
    // Break and Default have no background, so Up next keeps its card there.
    for (const layout of ["break", "default"]) {
      const host = draw({ view: "program", layout, projection: room("schedule", "checkIn") });
      expect(layer(host, "schedule"), layout).not.toBeNull();
      expect(layer(host, "schedule")?.hasAttribute("data-on-ground"), layout).toBe(false);
    }
    // Up next in Board left sits inside the column's background and drops its card.
    const column = draw({ view: "program", layout: "check-in", projection: room("schedule") });
    expect(layer(column, "schedule")?.hasAttribute("data-on-ground")).toBe(true);
    // So does the check-in code: no card on a card. Its quiet zone stays white for any phone camera.
    const code = draw({ view: "program", layout: "check-in", projection: room("checkIn") });
    expect(layer(code, "checkIn")?.hasAttribute("data-on-ground")).toBe(true);
    // In Default, with no background, it keeps its card.
    const corner = draw({ view: "program", layout: "default", projection: room("checkIn") });
    expect(layer(corner, "checkIn")).not.toBeNull();
    expect(layer(corner, "checkIn")?.hasAttribute("data-on-ground")).toBe(false);
  });

  it("gives the chat the whole column while the top questions above it have none to show", () => {
    const column = { x: 0, w: 0.4, visible: true, horizontal: "left", vertical: "middle", shared: false } as const;
    const elements = {
      ...LIVE_OVERLAY_STANDARD_ELEMENTS,
      topQuestions: { ...LIVE_OVERLAY_STANDARD_ELEMENTS.topQuestions, ...column, y: 0, h: 0.5 },
      chat: { ...LIVE_OVERLAY_STANDARD_ELEMENTS.chat, ...column, y: 0.5, h: 0.5 },
    };
    const chatFeed = {
      config: { count: 4, delaySeconds: 0 },
      messages: [
        { id: "m-1", authorName: "Ada", text: "Hello from the back row" },
        { id: "m-2", authorName: "Lin", text: "Slides are great" },
      ],
    };
    const withChat = (on: LiveRoomState): LiveRoomState => ({ ...on, stage: { ...on.stage, chatFeed } });
    // An empty list counts as not drawn: the chat fills its own box and the empty one above it.
    expect(liveListBox(elements, "chat", () => true)).toMatchObject({ y: 0.5, h: 0.5 });
    expect(liveListBox(elements, "chat", () => false)).toMatchObject({ x: 0, y: 0, w: 0.4, h: 1 });
    expect(liveListBox(elements, "topQuestions", () => false)).toMatchObject({ y: 0, h: 1 });
    // A list apart from its partner keeps its own box.
    const apart = { ...elements, chat: { ...elements.chat, x: 0.6 } };
    expect(liveListBox(apart, "chat", () => false)).toMatchObject({ x: 0.6, y: 0.5, h: 0.5 });
    const alone = draw({ view: "program", elements, projection: withChat(room()) });
    expect(drawn(alone)).toContain("chat");
    // Newest first in the markup, marked, so the newest always shows and the oldest leave whole.
    const messages = alone.querySelectorAll<HTMLElement>(".pk-live-lists__message");
    expect(messages[0]?.hasAttribute("data-newest")).toBe(true);
    expect([...messages].filter((message) => message.hasAttribute("data-newest"))).toHaveLength(1);
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
    // A column's panel goes without the mark.
    expect(marks(host)).toHaveLength(0);
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
