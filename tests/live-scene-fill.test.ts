import { describe, expect, it } from "vitest";
import {
  LIVE_OVERLAY_DEFAULT_POSITIONS,
  LIVE_OVERLAY_PRESET_LAYOUTS,
  LIVE_OVERLAY_STANDARD_ELEMENTS,
  isLiveOverlayPreset,
  resolveLiveOverlayLayout,
} from "../assets/shared/live-overlay-layout-presets";
import { liveCompositionInput } from "../assets/shared/live-room-preview";
import { resolveLiveSceneElements } from "../assets/shared/live-scene-elements";
import { liveSceneComesOn, liveSceneFill } from "../assets/shared/live-scene-fill";
import { liveOverlayClearOfTicker, liveProgramLayers } from "../assets/shared/live-overlay-stacking";
import {
  LIVE_OVERLAY_ELEMENTS,
  LIVE_OVERLAY_ELEMENT_SWITCHES,
  LIVE_OVERLAY_PRESETS,
  liveOverlayLayoutElementsSchema,
  type LiveOverlayElement,
  type LiveOverlayElementPlacement,
  type LiveOverlayLayoutElements,
} from "../assets/shared/schemas/live-overlay-layout";
import { DEFAULT_LIVE_TOP_QUESTIONS_CONFIG } from "../assets/shared/schemas/live-session-on-screen";
import {
  EMPTY_LIVE_STAGE,
  type LiveCompositionInput,
  type LiveStage,
} from "../assets/shared/schemas/live-session-room";
import { DEFAULT_LIVE_SCHEDULE_CONFIG } from "../assets/shared/schemas/live-session-schedule";
import { DEFAULT_LIVE_TICKER_CONFIG } from "../assets/shared/schemas/live-session-ticker";
import { defaultLiveTimerGraphic } from "../assets/shared/schemas/live-session-timer";

const preset = (slug: (typeof LIVE_OVERLAY_PRESETS)[number]) => LIVE_OVERLAY_PRESET_LAYOUTS[slug].elements;
const included = (elements: LiveOverlayLayoutElements) =>
  LIVE_OVERLAY_ELEMENTS.filter((element) => elements[element].visible);
const withPlacement = (
  elements: LiveOverlayLayoutElements,
  element: LiveOverlayElement,
  patch: Partial<LiveOverlayElementPlacement>,
): LiveOverlayLayoutElements => ({ ...elements, [element]: { ...elements[element], ...patch } });

/** The boards, which draw on a scene's background, and the cards, which carry their own. */
const FIELD_BOARDS = ["question", "poll", "panelists", "topQuestions", "chat"] as const;
const CARDS = ["schedule", "checkIn"] as const;
const meets = (a: LiveOverlayElementPlacement, b: LiveOverlayElementPlacement) =>
  a.x < b.x + b.w - 1e-6 && a.x + a.w > b.x + 1e-6 && a.y < b.y + b.h - 1e-6 && a.y + a.h > b.y + 1e-6;
const sameSpot = (a: LiveOverlayElementPlacement, b: LiveOverlayElementPlacement) =>
  a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

const EMPTY = liveCompositionInput(EMPTY_LIVE_STAGE);
const room = (program: Partial<LiveStage> = {}) => ({ program: { ...EMPTY_LIVE_STAGE, ...program } });
/** A composition with every pick made and every self-filling graphic off. */
const PICKED: LiveCompositionInput = {
  ...EMPTY,
  creditKey: "user:0",
  questionId: "question-1",
  pollId: "poll-1",
  timerGraphics: [defaultLiveTimerGraphic("session")],
  checkIn: { kind: "session", occurrenceId: "occurrence-1" },
};

describe("what puts a graphic on an output", () => {
  it("declares one way per graphic: a pick, the room, or the scene alone", () => {
    const by = (kind: string) =>
      LIVE_OVERLAY_ELEMENTS.filter((element) => LIVE_OVERLAY_ELEMENT_SWITCHES[element] === kind);
    expect(by("pick")).toEqual(["lowerThird", "question", "poll", "timer", "speakerWelcome", "checkIn"]);
    expect(by("room")).toEqual(["ticker", "schedule", "panelists", "topQuestions", "chat", "reactions"]);
    expect(by("scene")).toEqual(["background", "qrCode", "stageDisplay", "stageMessage"]);
  });

  it("lets only a graphic that fills itself from the room come on with a scene", () => {
    const comesOn = (element: LiveOverlayElement) =>
      liveOverlayLayoutElementsSchema.safeParse(
        withPlacement(LIVE_OVERLAY_STANDARD_ELEMENTS, element, { comesOn: true }),
      ).success;
    for (const element of LIVE_OVERLAY_ELEMENTS)
      expect(comesOn(element), element).toBe(LIVE_OVERLAY_ELEMENT_SWITCHES[element] === "room");
  });

  it("reads a scene saved without the setting as switched in the studio, and one with a board's old field flag without it", () => {
    const saved = liveOverlayLayoutElementsSchema.parse(LIVE_OVERLAY_STANDARD_ELEMENTS);
    expect(liveSceneComesOn(saved)).toEqual([]);
    const legacy = withPlacement(LIVE_OVERLAY_STANDARD_ELEMENTS, "topQuestions", {
      background: true,
    } as Partial<LiveOverlayElementPlacement>);
    const read = liveOverlayLayoutElementsSchema.parse(legacy);
    expect(read.topQuestions).toEqual(LIVE_OVERLAY_STANDARD_ELEMENTS.topQuestions);
  });
});

/** The scenes laid out for their boards; Camera instead shows whatever is switched on, over the picture. */
const BOARD_SCENES = LIVE_OVERLAY_PRESETS.filter((slug) => slug !== "default");

describe("the built-in scenes", () => {
  it("are Camera, Board right, Board left, Full board and Break; a retired name reads as Camera", () => {
    expect(LIVE_OVERLAY_PRESETS.map((slug) => LIVE_OVERLAY_PRESET_LAYOUTS[slug].name)).toEqual([
      "Camera",
      "Board right",
      "Board left",
      "Full board",
      "Break",
    ]);
    expect(isLiveOverlayPreset("talk")).toBe(false);
    expect(isLiveOverlayPreset("panel")).toBe(false);
    expect(resolveLiveOverlayLayout([], "panel")).toBe(preset("default"));
    expect(resolveLiveOverlayLayout([], "talk")).toBe(preset("default"));
    expect(resolveLiveSceneElements({ overlayLayouts: [] }, "talk")).toBe(preset("default"));
    expect(resolveLiveSceneElements(null, null)).toBe(preset("default"));
  });

  it("bring on only what the scene is for, and never a timer, ticker, lower third or reactions", () => {
    expect(Object.fromEntries(LIVE_OVERLAY_PRESETS.map((slug) => [slug, liveSceneComesOn(preset(slug))]))).toEqual({
      default: [],
      questions: ["topQuestions"],
      break: ["schedule"],
      "check-in": [],
      "full-board": [],
    });
    // Each still places the time, the ticker and reactions, so the studio can switch them in any scene.
    for (const slug of LIVE_OVERLAY_PRESETS)
      expect(included(preset(slug)), slug).toEqual(expect.arrayContaining(["timer", "ticker", "reactions"]));
    // The lower third is placed where a camera picture shows, not in Full board or Break.
    expect(LIVE_OVERLAY_PRESETS.filter((slug) => preset(slug).lowerThird.visible)).toEqual([
      "default",
      "questions",
      "check-in",
    ]);
  });

  it("make Camera show whatever is switched on: every graphic with a switch at its standard box, no background", () => {
    const elements = preset("default");
    expect(included(elements)).toEqual(
      LIVE_OVERLAY_ELEMENTS.filter((element) => element !== "background" && element !== "qrCode"),
    );
    expect(elements.background.visible).toBe(false);
    expect(elements.qrCode.visible).toBe(false);
    // The boards sit at their standard places, the same data Add graphic and a new scene use.
    for (const board of FIELD_BOARDS) {
      expect(elements[board]).toEqual(LIVE_OVERLAY_STANDARD_ELEMENTS[board]);
      expect(LIVE_OVERLAY_DEFAULT_POSITIONS[board], board).toEqual({
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        horizontal: "center",
        vertical: "middle",
      });
    }
  });

  it("place the background where the scene's boards sit, and none in Camera or Break", () => {
    const background = (slug: (typeof LIVE_OVERLAY_PRESETS)[number]) => {
      const { visible, x, y, w, h } = preset(slug).background;
      return visible ? { x, y, w, h } : null;
    };
    expect(background("default")).toBeNull();
    expect(background("break")).toBeNull();
    expect(background("questions")).toEqual({ x: 0.6, y: 0, w: 0.4, h: 1 });
    expect(background("check-in")).toEqual({ x: 0, y: 0, w: 0.4, h: 1 });
    expect(background("full-board")).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    // Boards and cards the scene includes sit inside its background, or clear of it over the camera.
    expect(preset("questions").topQuestions).toMatchObject(background("questions")!);
    expect(preset("check-in").checkIn).toMatchObject(background("check-in")!);
    // Every board a scene with boards includes lies inside that scene's background.
    for (const slug of BOARD_SCENES)
      for (const board of FIELD_BOARDS.filter((each) => preset(slug)[each].visible)) {
        const ground = background(slug);
        const { x, y, w, h } = preset(slug)[board];
        expect(ground, `${slug}: ${board}`).not.toBeNull();
        expect(
          x >= ground!.x && y >= ground!.y && x + w <= ground!.x + ground!.w + 1e-6 && y + h <= ground!.y + ground!.h,
          `${slug}: ${board}`,
        ).toBe(true);
      }
  });

  it("never overlap two boards by accident: they share one spot one at a time, or keep clear of each other", () => {
    const boards = [...FIELD_BOARDS, ...CARDS];
    for (const slug of BOARD_SCENES) {
      const elements = preset(slug);
      const shown = boards.filter((board) => elements[board].visible);
      for (const [index, one] of shown.entries())
        for (const other of shown.slice(index + 1))
          expect(
            sameSpot(elements[one], elements[other]) || !meets(elements[one], elements[other]),
            `${slug}: ${one} and ${other}`,
          ).toBe(true);
    }
  });

  it("keep the lower third clear of every board and the check-in code, and the timer clear of the cards", () => {
    for (const slug of BOARD_SCENES) {
      const elements = preset(slug);
      if (elements.lowerThird.visible)
        for (const board of [...FIELD_BOARDS, "checkIn"] as const)
          expect(elements[board].visible && meets(elements.lowerThird, elements[board]), `${slug}: ${board}`).toBe(
            false,
          );
      // Up next filling the background reads on it, as a board does; as a card it keeps clear of the timer.
      const upNextOnBackground = elements.background.visible && sameSpot(elements.schedule, elements.background);
      for (const card of CARDS.filter((each) => elements[each].visible))
        if (card !== "schedule" || !upNextOnBackground)
          expect(meets(elements.timer, elements[card]), `${slug}: timer and ${card}`).toBe(false);
    }
    // The timer sits over a board only where the scene's background runs under it, whose logo steps aside for it.
    const timerOnBoard = BOARD_SCENES.filter((slug) =>
      FIELD_BOARDS.some((board) => preset(slug)[board].visible && meets(preset(slug).timer, preset(slug)[board])),
    );
    expect(timerOnBoard).toEqual(["full-board"]);
    for (const slug of timerOnBoard) expect(meets(preset(slug).timer, preset(slug).background), slug).toBe(true);
  });

  it("end Up next above the lower third as it sits over the news ticker, so the two show together", () => {
    // The lower third draws about 230 px tall with its emblem, bottom-aligned in its box.
    const drawn = 230 / 1080;
    for (const slug of LIVE_OVERLAY_PRESETS) {
      const elements = preset(slug);
      if (!elements.schedule.visible || !elements.lowerThird.visible) continue;
      if (!meets({ ...elements.lowerThird, y: 0, h: 1 }, elements.schedule)) continue;
      const lowerThird = liveOverlayClearOfTicker(elements, true).lowerThird;
      const top = lowerThird.y + lowerThird.h - drawn;
      expect(elements.schedule.y + elements.schedule.h, slug).toBeLessThanOrEqual(top - 24 / 1080);
    }
  });

  it("stack a question and a poll in front of the lists that fill themselves, so a pick takes the spot they share", () => {
    for (const slug of LIVE_OVERLAY_PRESETS) {
      const bottomUp = liveProgramLayers(preset(slug));
      for (const pick of ["question", "poll"] as const)
        for (const list of ["topQuestions", "chat"] as const)
          expect(bottomUp.indexOf(pick), `${slug}: ${pick} over ${list}`).toBeGreaterThan(bottomUp.indexOf(list));
    }
  });
});

/** An event's own scene with the session graphic coming on, as no built-in scene brings it on. */
const panelScene = () => ({ ...preset("full-board"), panelists: { ...preset("full-board").panelists, comesOn: true } });

describe("loading a scene on a composition", () => {
  it("switches on the scene's comes-on graphics, filled as the room would", () => {
    expect(liveSceneFill(preset("questions"), EMPTY, room())).toEqual({
      topQuestions: DEFAULT_LIVE_TOP_QUESTIONS_CONFIG,
    });
    expect(liveSceneFill(preset("break"), EMPTY, room())).toEqual({
      schedule: { ...DEFAULT_LIVE_SCHEDULE_CONFIG, scope: "all-rooms" },
    });
    expect(liveSceneFill(panelScene(), EMPTY, room())).toEqual({ panelists: { layout: "panel" } });
  });

  it("gives a graphic the look Program shows it in", () => {
    const program = {
      panelists: { layout: "columns" as const },
      topQuestions: { config: { count: 3 }, questions: [] },
    };
    expect(liveSceneFill(panelScene(), EMPTY, room(program))).toEqual({ panelists: { layout: "columns" } });
    expect(liveSceneFill(preset("questions"), EMPTY, room(program))).toEqual({ topQuestions: { count: 3 } });
  });

  it("gives a graphic the event's saved look when Program shows none, and Program's over it", () => {
    const setup = {
      panelists: { layout: "columns" as const },
      topQuestions: { count: 4 },
      schedule: { ...DEFAULT_LIVE_SCHEDULE_CONFIG, scope: "this-room" as const, layout: "list" as const },
    };
    expect(liveSceneFill(panelScene(), EMPTY, { ...room(), setup })).toEqual({ panelists: { layout: "columns" } });
    expect(liveSceneFill(preset("questions"), EMPTY, { ...room(), setup })).toEqual({ topQuestions: { count: 4 } });
    // Up next still lists every room, as the studio's own switch puts it on.
    expect(liveSceneFill(preset("break"), EMPTY, { ...room(), setup })).toEqual({
      schedule: { ...setup.schedule, scope: "all-rooms" },
    });
    const program = room({ topQuestions: { config: { count: 2 }, questions: [] } });
    expect(liveSceneFill(preset("questions"), EMPTY, { ...program, setup })).toEqual({ topQuestions: { count: 2 } });
  });

  it("never touches a pick, and never switches on a graphic the scene only places", () => {
    for (const slug of LIVE_OVERLAY_PRESETS) {
      const fill = liveSceneFill(preset(slug), PICKED, room());
      // Only sources of the scene's comes-on graphics; the picks and every other switch are not in the change.
      const expected = { questions: ["topQuestions"], panel: ["panelists"], break: ["schedule"] }[slug as string] ?? [];
      expect(Object.keys(fill), slug).toEqual(expected);
    }
    for (const slug of ["default", "check-in", "full-board"] as const)
      expect(liveSceneFill(preset(slug), EMPTY, room()), slug).toEqual({});
  });

  it("never switches anything off, and leaves a graphic that is already on as it is", () => {
    const on: LiveCompositionInput = {
      ...PICKED,
      ticker: DEFAULT_LIVE_TICKER_CONFIG,
      topQuestions: { count: 2 },
      schedule: { ...DEFAULT_LIVE_SCHEDULE_CONFIG, layout: "list" },
      panelists: { layout: "list" },
      reactions: true,
    };
    for (const slug of LIVE_OVERLAY_PRESETS) {
      const fill = liveSceneFill(preset(slug), on, room());
      expect(fill, slug).toEqual({});
      expect({ ...on, ...fill }, slug).toEqual(on);
    }
  });

  it("works the same for an event's own scene, from its own per-graphic setting alone", () => {
    const own = liveOverlayLayoutElementsSchema.parse({
      ...withPlacement(
        withPlacement(withPlacement(preset("default"), "ticker", { comesOn: true }), "reactions", { comesOn: true }),
        "chat",
        { comesOn: true, visible: false },
      ),
    });
    const layouts = [{ slug: "keynote", name: "Keynote", elements: own }];
    const scene = resolveLiveSceneElements({ overlayLayouts: layouts }, "keynote");
    // The chat is set to come on but the scene does not include it, so it stays off.
    expect(liveSceneComesOn(scene)).toEqual(["ticker", "reactions"]);
    expect(liveSceneFill(scene, PICKED, room())).toEqual({ ticker: DEFAULT_LIVE_TICKER_CONFIG, reactions: true });
  });
});
