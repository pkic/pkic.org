import { liveOverlayCoveredBy } from "../assets/shared/live-overlay-cover";
import {
  LIVE_PROGRAM_LAYER_ORDER,
  liveOverlayClearOfTicker,
  liveProgramLayers,
  moveLiveProgramLayer,
} from "../assets/shared/live-overlay-stacking";
import { EMPTY_LIVE_STAGE, type LiveStage } from "../assets/shared/schemas/live-session-room";
import { describe, expect, it } from "vitest";
import { liveOverlayLayerTransform, placeOverlayGraphic } from "../assets/shared/live-overlay-geometry";
import {
  LIVE_OVERLAY_PRESET_LAYOUTS,
  LIVE_OVERLAY_STANDARD_ELEMENTS,
  liveOverlayLayoutChoices,
  resolveLiveOverlayLayout,
} from "../assets/shared/live-overlay-layout-presets";
import { liveTimerLayout } from "../assets/shared/live-timer-policy";
import {
  LIVE_OVERLAY_PRESETS,
  liveOverlayLayoutElementsSchema,
  type LiveOverlayElementPlacement,
} from "../assets/shared/schemas/live-overlay-layout";
import {
  fieldValue,
  fractionOf,
  moveBox,
  nudgeBox,
  resizeBox,
  shapeBox,
  snapPeers,
  snapTargets,
  type Box,
} from "../assets/ts/member-flows/portal/sections/events/detail/settings/live-layouts/overlay-layout-editing";
import { layoutSlugFor } from "../assets/ts/member-flows/portal/sections/events/detail/settings/live-layouts/overlay-layout-slug";
import { layoutLabelPlaces } from "../assets/ts/member-flows/portal/sections/events/detail/settings/live-layouts/overlay-layout-labels";
import { LIVE_OVERLAY_ELEMENT_LABELS } from "../assets/shared/schemas/live-overlay-layout";

/** Every graphic at its standard box, all shown. */
const STANDARD = LIVE_OVERLAY_STANDARD_ELEMENTS;
const placement = (box: Box, anchor: Partial<LiveOverlayElementPlacement> = {}): LiveOverlayElementPlacement => ({
  visible: true,
  shared: false,
  horizontal: "left",
  vertical: "top",
  ...box,
  ...anchor,
});
const px = (x: number, y: number, w: number, h: number): Box => ({
  x: x / 1920,
  y: y / 1080,
  w: w / 1920,
  h: h / 1080,
});
const free = { targets: { vertical: [], horizontal: [] }, threshold: { x: 0, y: 0 }, snap: false };

describe("placing a graphic in its layout box", () => {
  it("fits the graphic whole at its anchor, keeping its shape", () => {
    const natural = { x: 96, y: 808, width: 1200, height: 200 };
    expect(placeOverlayGraphic(placement(px(0, 0, 600, 400), { vertical: "bottom" }), natural)).toEqual({
      x: 0,
      y: 300,
      width: 600,
      height: 100,
    });
    const centered = placeOverlayGraphic(placement(px(100, 100, 2400 / 2, 100), { horizontal: "center" }), natural);
    expect(centered).toEqual({ x: 400, y: 100, width: 600, height: 100 });
  });

  it("moves and scales a drawn graphic onto its placed box, and leaves one already in place untouched", () => {
    const natural = { x: 96, y: 808, width: 1200, height: 200 };
    // The graphic fits a 600 × 400 box at the bottom: half size, its top-left at (0, 300).
    expect(liveOverlayLayerTransform(placement(px(0, 0, 600, 400), { vertical: "bottom" }), natural)).toEqual({
      dx: -48,
      dy: -104,
      scale: 0.5,
      identity: false,
    });
    expect(liveOverlayLayerTransform(placement(px(96, 808, 1200, 200)), natural)).toEqual({
      dx: 0,
      dy: 0,
      scale: 1,
      identity: true,
    });
  });

  it("puts a timer graphic in the layout's box unless it names its own corner", () => {
    const timer = placement(px(1392, 48, 480, 168), { horizontal: "right" });
    const inLayout = liveTimerLayout({ placement: "layout", size: "medium" }, timer);
    expect(inLayout.x * 1920 + inLayout.w * 1920).toBeCloseTo(1872);
    expect(inLayout.w * 1920).toBeCloseTo(360);
    const cornered = liveTimerLayout({ placement: "bottom-left", size: "large" }, timer);
    expect(cornered).toMatchObject({ horizontal: "left", vertical: "bottom", visible: true });
    expect(cornered.x).toBeCloseTo(0.05);
    expect(cornered.y + cornered.h).toBeCloseTo(0.95);
    // Its own corner keeps the standard timer's size, not the layout box's.
    expect(cornered.w * 1920).toBeCloseTo(336, 1);
    expect(cornered.h * 1080).toBeCloseTo(120, 1);
  });

  it("keeps a timer with its own corner the same in every scene, whatever else goes on air", () => {
    const graphic = { placement: "top-right", size: "large" } as const;
    const frame = ({ x, y, w, h }: { x: number; y: number; w: number; h: number }) => ({ x, y, w, h });
    const standard = liveTimerLayout(graphic, LIVE_OVERLAY_PRESET_LAYOUTS.default.elements.timer);
    // A timer the operator placed keeps its corner in every scene.
    for (const scene of ["break", "questions", "check-in"] as const)
      expect(frame(liveTimerLayout(graphic, LIVE_OVERLAY_PRESET_LAYOUTS[scene].elements.timer))).toEqual(
        frame(standard),
      );
    expect((standard.x + standard.w) * 1920).toBeCloseTo(1824);
    // One left to the layout follows the scene's box: Break hangs it in the top-right corner, over Up next.
    const inBreak = liveTimerLayout(
      { placement: "layout", size: "large" },
      LIVE_OVERLAY_PRESET_LAYOUTS.break.elements.timer,
    );
    expect(inBreak.vertical).toBe("top");
    expect(inBreak.horizontal).toBe("right");
    expect(inBreak.y + inBreak.h).toBeLessThanOrEqual(LIVE_OVERLAY_PRESET_LAYOUTS.break.elements.schedule.y);
  });
});

describe("built-in layouts", () => {
  it("are valid layouts, and an unknown name draws the default", () => {
    for (const preset of LIVE_OVERLAY_PRESETS)
      expect(liveOverlayLayoutElementsSchema.safeParse(LIVE_OVERLAY_PRESET_LAYOUTS[preset].elements).success).toBe(
        true,
      );
    expect(resolveLiveOverlayLayout([], "no-such-layout")).toBe(LIVE_OVERLAY_PRESET_LAYOUTS.default.elements);
    const saved = { slug: "keynote", name: "Keynote", elements: LIVE_OVERLAY_PRESET_LAYOUTS["break"].elements };
    expect(resolveLiveOverlayLayout([saved], "keynote")).toBe(saved.elements);
    expect(resolveLiveOverlayLayout([saved], "check-in").checkIn.visible).toBe(true);
    // Board left holds any board, the question included.
    expect(resolveLiveOverlayLayout([saved], "check-in").question.visible).toBe(true);
    // A scene of the event's own named after a retired built-in is just one of its scenes.
    expect(liveOverlayLayoutChoices([saved, { ...saved, slug: "panel", name: "Our panel" }])).toEqual([
      { slug: "default", name: "Camera" },
      { slug: "questions", name: "Board right" },
      { slug: "check-in", name: "Board left" },
      { slug: "full-board", name: "Full board" },
      { slug: "break", name: "Break" },
      { slug: "keynote", name: "Keynote" },
      { slug: "panel", name: "Our panel" },
    ]);
  });
});

describe("editing a box", () => {
  const box = px(100, 100, 400, 200);
  const other = px(960, 540, 480, 270);
  const snapping = { targets: snapTargets([other]), threshold: { x: 8 / 1920, y: 8 / 1080 }, snap: true };

  it("snaps a moved box's edges to another box and the safe area, and shows the guide it holds", () => {
    const moved = moveBox(box, (955 - 500) / 1920, -50 / 1080, snapping);
    // Its right edge lands on the other box's left edge; its top on the title-safe line.
    expect(moved.box.x * 1920 + moved.box.w * 1920).toBeCloseTo(960, 0);
    expect(moved.box.y).toBeCloseTo(0.05, 3);
    expect(moved.guides.vertical[0]).toBeCloseTo(0.5);
    expect(moved.guides.horizontal[0]).toBeCloseTo(0.05);
  });

  it("falls back to the 24 px grid away from guides, and follows the pointer exactly without snapping", () => {
    const gridded = moveBox(box, 37 / 1920, 0, snapping);
    expect((gridded.box.x * 1920) % 24).toBeCloseTo(0, 0);
    expect(gridded.guides).toEqual({ vertical: [], horizontal: [] });
    expect(moveBox(box, 37 / 1920, 0, free).box.x * 1920).toBeCloseTo(137, 0);
  });

  it("does not snap back to the graphics sharing the spot it starts from", () => {
    const spot = px(1152, 0, 768, 1000);
    const peers = snapPeers(spot, [spot, { ...spot }, other]);
    expect(peers).toEqual([other]);
    // The studio's small canvas: 8 screen pixels are about 28 of the frame's.
    const options = { snap: true, threshold: { x: 28 / 1920, y: 28 / 1080 }, targets: snapTargets(peers) };
    // A small resize stays where it was dropped, on the grid, not back at the spot's edge.
    expect(resizeBox(spot, "w", -20 / 1920, 0, options).box.x * 1920).toBeCloseTo(1128, 0);
    // Its right edge left the frame's edge on purpose, so the frame does not pull it back; a slip of the hand does not move it.
    const moved = moveBox(spot, -20 / 1920, 5 / 1080, options).box;
    expect(moved.x * 1920).toBeCloseTo(1132, 0);
    expect(moved.y).toBe(0);
  });

  it("keeps a moved box inside the frame", () => {
    const moved = moveBox(box, 5, -5, free).box;
    expect(moved.x + moved.w).toBeCloseTo(1);
    expect(moved.y).toBe(0);
  });

  it("resizes from a handle, keeping the opposite edges and a minimum size", () => {
    const wider = resizeBox(box, "se", 50 / 1920, 0, free).box;
    expect(wider.x).toBeCloseTo(box.x);
    expect(wider.w * 1920).toBeCloseTo(450, 0);
    const fromLeft = resizeBox(box, "w", 2, 0, free).box;
    expect(fromLeft.x + fromLeft.w).toBeCloseTo(box.x + box.w, 3);
    expect(fromLeft.w).toBeCloseTo(0.02);
    const snapped = resizeBox(box, "e", (955 - 500) / 1920, 0, snapping);
    expect((snapped.box.x + snapped.box.w) * 1920).toBeCloseTo(960, 0);
  });

  it("moves only a side handle's edge, with snapping on, and never the edges across from it", () => {
    for (const [handle, dx, dy] of [
      ["n", 0, -37 / 1080],
      ["s", 0, 41 / 1080],
      ["e", 53 / 1920, 0],
      ["w", -29 / 1920, 0],
    ] as const) {
      const after = resizeBox(box, handle, dx, dy, snapping).box;
      const edges = (b: typeof box) => ({ left: b.x, right: b.x + b.w, top: b.y, bottom: b.y + b.h });
      const was = edges(box);
      const now = edges(after);
      const kept = {
        n: ["left", "right", "bottom"],
        s: ["left", "right", "top"],
        e: ["left", "top", "bottom"],
        w: ["right", "top", "bottom"],
      }[handle] as Array<keyof typeof was>;
      for (const edge of kept) expect(now[edge]).toBeCloseTo(was[edge], 3);
      // The dragged edge itself moves the way the pointer went.
      const moved = { n: "top", s: "bottom", e: "right", w: "left" }[handle] as keyof typeof was;
      expect(Math.sign(now[moved] - was[moved])).toBe(Math.sign(dx + dy));
    }
  });

  it("keeps a corner-resized box the shape of its graphic, so the graphic fills it", () => {
    // A square card in a 400 × 200 box, dragged wider: the width the pointer set gives the height too.
    const wider = shapeBox(resizeBox(box, "se", 200 / 1920, 10 / 1080, free), box, "se", 1).box;
    expect(wider.w * 1920).toBeCloseTo(600, 0);
    expect(wider.h * 1080).toBeCloseTo(600, 0);
    expect(wider.x).toBeCloseTo(box.x, 3);
    expect(wider.y).toBeCloseTo(box.y, 3);
    // Dragged up from the top-left corner, the height sets the size and the bottom-right corner stays.
    const taller = shapeBox(resizeBox(box, "nw", 0, -50 / 1080, free), box, "nw", 2).box;
    expect(taller.h * 1080).toBeCloseTo(250, 0);
    expect(taller.w * 1920).toBeCloseTo(500, 0);
    expect((taller.x + taller.w) * 1920).toBeCloseTo(500, 0);
    expect((taller.y + taller.h) * 1080).toBeCloseTo(300, 0);
    // A full-frame graphic dragged past the frame stops at the frame, still its shape.
    const full = shapeBox(resizeBox(box, "se", 2, 2, free), box, "se", 16 / 9).box;
    expect(full.x + full.w).toBeLessThanOrEqual(1);
    expect(full.y + full.h).toBeLessThanOrEqual(1);
    expect((full.w * 1920) / (full.h * 1080)).toBeCloseTo(16 / 9, 2);
  });

  it("nudges by a pixel, or by a grid step with Shift", () => {
    expect(nudgeBox(box, "right", false).x * 1920).toBeCloseTo(101, 0);
    expect(nudgeBox(box, "up", true).y * 1080).toBeCloseTo(76, 0);
  });

  it("reads and writes numeric fields in percent or pixels", () => {
    expect(fieldValue(0.25, "x", "percent")).toBe(25);
    expect(fieldValue(0.25, "x", "pixels")).toBe(480);
    expect(fractionOf("540", "y", "pixels")).toBe(0.5);
    expect(fractionOf("12.5", "x", "percent")).toBe(0.125);
    expect(fractionOf("", "x", "percent")).toBeNaN();
  });

  it("moves a box's name to its bottom edge when it would cover another box's name", () => {
    const places = layoutLabelPlaces(STANDARD, ["reactions", "timer", "ticker"], LIVE_OVERLAY_ELEMENT_LABELS);
    expect(places).toEqual({
      reactions: { side: "top", along: 0 },
      timer: { side: "bottom", along: 0 },
      ticker: { side: "top", along: 0 },
    });
  });

  it("moves a third name along the edge when boxes share one place", () => {
    const frame = { visible: true, shared: false, x: 0, y: 0, w: 1, h: 1 };
    const elements = { ...STANDARD, poll: frame, question: frame, topQuestions: frame } as typeof STANDARD;
    const places = layoutLabelPlaces(elements, ["poll", "question", "topQuestions"], LIVE_OVERLAY_ELEMENT_LABELS);
    expect(places.poll).toEqual({ side: "top", along: 0 });
    expect(places.question).toEqual({ side: "bottom", along: 0 });
    expect(places.topQuestions.side).toBe("top");
    expect(places.topQuestions.along).toBeGreaterThan(0);
  });

  it("names a new layout for source links, numbered when the name is taken", () => {
    expect(layoutSlugFor("Keynote — Main Hall", new Set())).toBe("keynote-main-hall");
    expect(layoutSlugFor("Talk", new Set(["talk"]))).toBe("talk-2");
    expect(layoutSlugFor("!!!", new Set())).toBe("layout");
  });
});

describe("a graphic a board covers", () => {
  const onAir = (stage: Partial<LiveStage>): LiveStage => ({ ...EMPTY_LIVE_STAGE, ...stage }) as LiveStage;
  const schedule = { config: {} } as unknown as LiveStage["schedule"];
  const question = { id: "q1" } as unknown as LiveStage["question"];

  it("names the full-screen question that hides Up next, and nothing once the question is off", () => {
    expect(liveOverlayCoveredBy(onAir({ schedule, question }), STANDARD, "schedule")).toBe("question");
    expect(liveOverlayCoveredBy(onAir({ schedule }), STANDARD, "schedule")).toBeNull();
  });

  it("never reports a graphic drawn above the board, such as a timer over a question", () => {
    const timerGraphics = [{ timerId: "t1" }] as unknown as LiveStage["timerGraphics"];
    expect(liveOverlayCoveredBy(onAir({ question, timerGraphics }), STANDARD, "timer")).toBeNull();
  });

  it("keeps Up next and the check-in code clear of each other at their standard boxes", () => {
    const checkIn = { selection: {} } as unknown as LiveStage["checkIn"];
    expect(liveOverlayCoveredBy(onAir({ schedule, checkIn }), STANDARD, "schedule")).toBeNull();
  });
});

describe("stacking a scene's graphics", () => {
  it("keeps the built-in order until a scene orders them, and saves a move as the scene's own stack", () => {
    expect(liveProgramLayers(STANDARD)).toEqual([...LIVE_PROGRAM_LAYER_ORDER]);
    // Up in the editor's front-first list: Up next draws in front of the check-in code.
    const moved = moveLiveProgramLayer(STANDARD, "schedule", -1);
    const stack = liveProgramLayers(moved);
    expect(stack.indexOf("schedule")).toBe(stack.indexOf("checkIn") + 1);
    expect(liveOverlayLayoutElementsSchema.parse(moved).schedule.layer).toBe(stack.indexOf("schedule"));
    // The front of the list cannot move further up.
    expect(moveLiveProgramLayer(STANDARD, "reactions", -1)).toBe(STANDARD);
  });

  it("reads a scene saved before backgrounds with the background hidden, so it looks as it did", () => {
    const { background: _added, ...saved } = STANDARD;
    const read = liveOverlayLayoutElementsSchema.parse(saved);
    expect(read.background.visible).toBe(false);
    expect(liveProgramLayers(read)[0]).toBe("background");
    // At the back it moves no further back; a scene can still bring it forward like any other graphic.
    expect(moveLiveProgramLayer(read, "background", 1)).toBe(read);
    const forward = liveProgramLayers(moveLiveProgramLayer(read, "background", -1));
    expect(forward.slice(0, 2)).toEqual(["panelists", "background"]);
  });

  it("lets a board drawn in front hide a graphic only from where the scene stacks it", () => {
    const onAir = { ...EMPTY_LIVE_STAGE, schedule: { config: {} }, question: { id: "q1" } } as unknown as LiveStage;
    // Up next starts four places behind the question: the check-in code and the two lists sit between them.
    const scheduleInFront = [1, 2, 3, 4].reduce((scene) => moveLiveProgramLayer(scene, "schedule", -1), STANDARD);
    expect(liveOverlayCoveredBy(onAir, STANDARD, "schedule")).toBe("question");
    expect(liveOverlayCoveredBy(onAir, scheduleInFront, "schedule")).toBeNull();
  });

  it("keeps every graphic clear of the ticker while it is on air, boards flush and floating graphics with a gap, and gives the full height back once it is off", () => {
    const scene = {
      ...STANDARD,
      topQuestions: placement(px(0, 0, 1920, 1080)),
      reactions: placement(px(0, 0, 1920, 1080)),
    };
    const clear = liveOverlayClearOfTicker(scene, true);
    // A board that runs to the bottom edge meets the ticker flush, so its background has no seam.
    expect(clear.topQuestions.y + clear.topQuestions.h).toBeCloseTo(scene.ticker.y);
    // A floating graphic is pushed up, keeping its size, to a small gap above it.
    expect(clear.lowerThird.y + clear.lowerThird.h).toBeCloseTo(scene.ticker.y - 24 / 1080);
    expect(clear.lowerThird.h).toBe(scene.lowerThird.h);
    // Reactions float over everything, the ticker included.
    expect(clear.reactions).toEqual(scene.reactions);
    // A graphic beside the ticker, not above it, keeps its box.
    const beside = {
      ...scene,
      ticker: { ...scene.ticker, ...px(768, 954, 1152, 126) },
      question: placement(px(0, 0, 768, 1080)),
    };
    expect(liveOverlayClearOfTicker(beside, true).question).toEqual(beside.question);
    expect(liveOverlayClearOfTicker(scene, false)).toBe(scene);
  });
});
