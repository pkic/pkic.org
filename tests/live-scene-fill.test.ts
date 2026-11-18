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
  type LiveCredit,
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
const credits = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ key: `user:${index}` }) as LiveCredit);
const room = (program: Partial<LiveStage> = {}, speakers = 2) => ({
  session: { credits: credits(speakers) },
  program: { ...EMPTY_LIVE_STAGE, ...program },
});
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
    expect(by("pick")).toEqual(["lowerThird", "question", "poll", "timer", "checkIn"]);
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

describe("the built-in scenes", () => {
  it("are Default, Q&A, Panel, Break, Check-in and Full board; a retired name reads as Default", () => {
    expect(LIVE_OVERLAY_PRESETS.map((slug) => LIVE_OVERLAY_PRESET_LAYOUTS[slug].name)).toEqual([
      "Default",
      "Q&A",
      "Panel",
      "Break",
      "Check-in",
      "Full board",
    ]);
    expect(isLiveOverlayPreset("talk")).toBe(false);
    expect(resolveLiveOverlayLayout([], "talk")).toBe(preset("default"));
    expect(resolveLiveSceneElements({ overlayLayouts: [] }, "talk")).toBe(preset("default"));
    expect(resolveLiveSceneElements(null, null)).toBe(preset("default"));
  });

  it("bring on only what the scene is for, and never a timer, ticker, lower third or reactions", () => {
    expect(Object.fromEntries(LIVE_OVERLAY_PRESETS.map((slug) => [slug, liveSceneComesOn(preset(slug))]))).toEqual({
      default: [],
      questions: ["topQuestions"],
      panel: ["panelists"],
      break: ["schedule"],
      "check-in": [],
      "full-board": [],
    });
    // Each still places the time, the ticker and reactions, so the studio can switch them in any scene.
    for (const slug of LIVE_OVERLAY_PRESETS)
      expect(included(preset(slug)), slug).toEqual(expect.arrayContaining(["timer", "ticker", "reactions"]));
    // The lower third is placed where a camera picture shows: not over Panel's people, nor in Full board.
    expect(LIVE_OVERLAY_PRESETS.filter((slug) => preset(slug).lowerThird.visible)).toEqual([
      "default",
      "questions",
      "break",
      "check-in",
    ]);
  });

  it("make Default the empty scene: only graphics that sit over the picture, no board and no background", () => {
    const elements = preset("default");
    expect(included(elements)).toEqual([
      "lowerThird",
      "timer",
      "ticker",
      "schedule",
      "checkIn",
      "reactions",
      "stageDisplay",
      "stageMessage",
    ]);
    for (const board of [...FIELD_BOARDS, "background", "qrCode"] as const)
      expect(elements[board].visible, board).toBe(false);
    // The boards keep their standard places as data, for Add graphic and for a new scene.
    for (const board of FIELD_BOARDS) {
      expect(LIVE_OVERLAY_STANDARD_ELEMENTS[board].visible, board).toBe(true);
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

  it("place the background where the scene's boards sit, and none in Default or Break", () => {
    const background = (slug: (typeof LIVE_OVERLAY_PRESETS)[number]) => {
      const { visible, x, y, w, h } = preset(slug).background;
      return visible ? { x, y, w, h } : null;
    };
    expect(background("default")).toBeNull();
    expect(background("break")).toBeNull();
    expect(background("questions")).toEqual({ x: 0.6, y: 0, w: 0.4, h: 1 });
    expect(background("check-in")).toEqual({ x: 0, y: 0, w: 0.4, h: 1 });
    expect(background("panel")).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(background("full-board")).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    // Boards and cards the scene includes sit inside its background, or clear of it over the camera.
    expect(preset("questions").topQuestions).toMatchObject(background("questions")!);
    expect(preset("check-in").checkIn).toMatchObject(background("check-in")!);
    // Every board a built-in scene includes lies inside that scene's background.
    for (const slug of LIVE_OVERLAY_PRESETS)
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
    for (const slug of LIVE_OVERLAY_PRESETS) {
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
    for (const slug of LIVE_OVERLAY_PRESETS) {
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
    const timerOnBoard = LIVE_OVERLAY_PRESETS.filter((slug) =>
      FIELD_BOARDS.some((board) => preset(slug)[board].visible && meets(preset(slug).timer, preset(slug)[board])),
    );
    expect(timerOnBoard).toEqual(["panel", "full-board"]);
    for (const slug of timerOnBoard) expect(meets(preset(slug).timer, preset(slug).background), slug).toBe(true);
  });
});

describe("loading a scene on a composition", () => {
  it("switches on the scene's comes-on graphics, filled as the room would", () => {
    expect(liveSceneFill(preset("questions"), EMPTY, room())).toEqual({
      topQuestions: DEFAULT_LIVE_TOP_QUESTIONS_CONFIG,
    });
    expect(liveSceneFill(preset("break"), EMPTY, room())).toEqual({
      schedule: { ...DEFAULT_LIVE_SCHEDULE_CONFIG, scope: "all-rooms" },
    });
    expect(liveSceneFill(preset("panel"), EMPTY, room())).toEqual({ panelists: { layout: "panel" } });
  });

  it("gives a graphic the look Program shows it in, and leaves the panel off for a session with one speaker", () => {
    const program = {
      panelists: { layout: "columns" as const },
      topQuestions: { config: { count: 3 }, questions: [] },
    };
    expect(liveSceneFill(preset("panel"), EMPTY, room(program))).toEqual({ panelists: { layout: "columns" } });
    expect(liveSceneFill(preset("questions"), EMPTY, room(program))).toEqual({ topQuestions: { count: 3 } });
    expect(liveSceneFill(preset("panel"), EMPTY, room({}, 1))).toEqual({});
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
