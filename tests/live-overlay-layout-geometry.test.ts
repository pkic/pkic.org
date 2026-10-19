import { describe, expect, it } from "vitest";
import { liveOverlayLayerTransform, placeOverlayGraphic } from "../assets/shared/live-overlay-geometry";
import {
  LIVE_OVERLAY_PRESET_LAYOUTS,
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
  snapTargets,
  type Box,
} from "../assets/ts/member-flows/portal/sections/events/detail/settings/live-layouts/overlay-layout-editing";
import { layoutSlugFor } from "../assets/ts/member-flows/portal/sections/events/detail/settings/live-layouts/overlay-layout-slug";
import { layoutLabelSides } from "../assets/ts/member-flows/portal/sections/events/detail/settings/live-layouts/overlay-layout-labels";
import { LIVE_OVERLAY_ELEMENT_LABELS } from "../assets/shared/schemas/live-overlay-layout";

const FULL_FRAME = LIVE_OVERLAY_PRESET_LAYOUTS["full-frame"].elements;
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
  });
});

describe("built-in layouts", () => {
  it("are valid layouts, and an unknown name draws the default", () => {
    for (const preset of LIVE_OVERLAY_PRESETS)
      expect(liveOverlayLayoutElementsSchema.safeParse(LIVE_OVERLAY_PRESET_LAYOUTS[preset].elements).success).toBe(
        true,
      );
    expect(resolveLiveOverlayLayout([], "no-such-layout")).toBe(FULL_FRAME);
    const saved = { slug: "keynote", name: "Keynote", elements: LIVE_OVERLAY_PRESET_LAYOUTS["ticker-only"].elements };
    expect(resolveLiveOverlayLayout([saved], "keynote")).toBe(saved.elements);
    expect(resolveLiveOverlayLayout([saved], "lower-third").lowerThird.visible).toBe(true);
    expect(resolveLiveOverlayLayout([saved], "lower-third").question.visible).toBe(false);
    expect(liveOverlayLayoutChoices([saved, { ...saved, slug: "panel", name: "Our panel" }]).slice(-3)).toEqual([
      { slug: "panel", name: "Our panel" },
      { slug: "ticker-only", name: "Ticker only" },
      { slug: "keynote", name: "Keynote" },
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

  it("moves a box's label to its bottom edge when it would cover another box's label", () => {
    const sides = layoutLabelSides(FULL_FRAME, ["reactions", "timer", "ticker"], LIVE_OVERLAY_ELEMENT_LABELS);
    expect(sides).toEqual({ reactions: "top", timer: "bottom", ticker: "top" });
  });

  it("names a new layout for source links, numbered when the name is taken", () => {
    expect(layoutSlugFor("Keynote — Main Hall", new Set())).toBe("keynote-main-hall");
    expect(layoutSlugFor("Full frame", new Set(["full-frame"]))).toBe("full-frame-2");
    expect(layoutSlugFor("!!!", new Set())).toBe("layout");
  });
});
