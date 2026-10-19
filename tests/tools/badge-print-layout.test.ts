import { describe, expect, it } from "vitest";
import {
  BADGE_PRINT_PRESETS,
  badgePrintPages,
  badgePrintPreset,
  type BadgePrintPage,
} from "../../assets/shared/badge-print-layout";
import { badgePrintLayoutSchema, badgePrintPageDimensions } from "../../assets/shared/schemas/badge-print-layout";

describe("physical badge print layouts", () => {
  it("places a complete A6 front/back pair within an A4 landscape sheet at actual size", () => {
    const pages = [...badgePrintPages(1, badgePrintPreset("a6_front_back_a4"))];
    expect(pages).toEqual([
      {
        widthMm: 297,
        heightMm: 210,
        slots: [
          { itemIndex: 0, copyIndex: 0, side: "front", xMm: 43.5, yMm: 31, widthMm: 105, heightMm: 148 },
          { itemIndex: 0, copyIndex: 0, side: "back", xMm: 148.5, yMm: 31, widthMm: 105, heightMm: 148 },
        ],
      },
    ]);
    expect(
      badgePrintLayoutSchema.safeParse({
        ...badgePrintPreset("a6_front_back_a4"),
        page: { size: "a4", orientation: "portrait" },
      }).success,
    ).toBe(false);
  });

  it("keeps the same badge and copy on separate A6 front/back pages", () => {
    const layout = { ...badgePrintPreset("a6"), copies: 2 };
    const pages = [...badgePrintPages(2, layout)];
    expect(pages).toHaveLength(8);
    expect(pages.every((page) => page.widthMm === 105 && page.heightMm === 148 && page.slots.length === 1)).toBe(true);
    expect(pages.map((page) => [page.slots[0].itemIndex, page.slots[0].copyIndex, page.slots[0].side])).toEqual([
      [0, 0, "front"],
      [0, 0, "back"],
      [0, 1, "front"],
      [0, 1, "back"],
      [1, 0, "front"],
      [1, 0, "back"],
      [1, 1, "front"],
      [1, 1, "back"],
    ]);
  });

  it("uses the official Avery 5395 PDF's first and last label outlines, including gutters", () => {
    // Official blank PDF U-0121-01: 612×792pt paper; outlines (49.5,583.524)
    // and (319.5,39.124), each243×167.976pt. The PDF origin is bottom-left.
    const page = [...badgePrintPages(8, badgePrintPreset("avery_5395"))][0];
    expect(page.widthMm).toBe(215.9);
    expect(page.heightMm).toBe(279.4);
    expect(page.slots).toHaveLength(8);
    const first = page.slots[0];
    const last = page.slots[7];
    expect(first.xMm).toBeCloseTo((49.5 * 25.4) / 72, 9);
    expect(first.yMm).toBeCloseTo(((792 - 583.524 - 167.976) * 25.4) / 72, 9);
    expect(last.xMm).toBeCloseTo((319.5 * 25.4) / 72, 9);
    expect(last.yMm).toBeCloseTo(((792 - 39.124 - 167.976) * 25.4) / 72, 9);
    expect(last.widthMm).toBeCloseTo((243 * 25.4) / 72, 9);
    expect(last.heightMm).toBeCloseTo((167.976 * 25.4) / 72, 9);
  });

  it("continues Avery Letter label sheets onto a final partial sheet without losing or repeating attendees", () => {
    const pages = [...badgePrintPages(31, badgePrintPreset("avery_5160"))];
    expect(pages.map((page) => page.slots.length)).toEqual([30, 1]);
    expect(pages.flatMap((page) => page.slots.map((slot) => slot.itemIndex))).toEqual(
      Array.from({ length: 31 }, (_, index) => index),
    );
    expect(pages[0].slots[0].xMm).toBeCloseTo(4.7625, 9);
    expect(pages[0].slots[3].yMm).toBeCloseTo(38.1, 9);
    expect(pages[1].slots[0].xMm).toBe(pages[0].slots[0].xMm);
  });

  it("uses the official L7163 Word grid's seven rows and two columns at twip precision", () => {
    const page = [...badgePrintPages(14, badgePrintPreset("avery_l7163"))][0];
    expect(page.slots).toHaveLength(14);
    expect(page.slots[0].widthMm).toBeCloseTo(99.06, 9);
    expect(page.slots[1].xMm - page.slots[0].xMm).toBeCloseTo(101.6, 9);
    expect(page.slots[12].yMm - page.slots[0].yMm).toBeCloseTo(228.6, 9);
  });

  it("refuses negative, nonfinite, fractional, excessive, or physically overflowing settings", () => {
    const preset = badgePrintPreset("label_100_50");
    for (const changed of [
      { copies: 0 },
      { copies: 1.5 },
      { copies: 101 },
      { rows: 0 },
      { columns: 2 },
      { label: { widthMm: 100.001, heightMm: 50 } },
      { label: { widthMm: 100, heightMm: 50.001 } },
      { label: { widthMm: Number.NaN, heightMm: 50 } },
      { gaps: { horizontalMm: -1, verticalMm: 0 } },
      { margins: { leftMm: 0, rightMm: 0, topMm: 0, bottomMm: Number.POSITIVE_INFINITY } },
      { sides: "front_back", backPlacement: "adjacent" },
    ])
      expect(badgePrintLayoutSchema.safeParse({ ...preset, ...changed }).success).toBe(false);
    expect(
      badgePrintLayoutSchema.safeParse({
        ...preset,
        page: { size: "custom", orientation: "portrait", widthMm: 1000, heightMm: 1000 },
        label: { widthMm: 1, heightMm: 1 },
        columns: 100,
        rows: 100,
      }).success,
    ).toBe(false);
  });

  it("supports custom margins/gaps and explicit page orientation without scaling labels", () => {
    const layout = badgePrintLayoutSchema.parse({
      ...badgePrintPreset("label_100_50"),
      page: { size: "custom", orientation: "landscape", widthMm: 100, heightMm: 150 },
      label: { widthMm: 40, heightMm: 20 },
      columns: 3,
      rows: 2,
      margins: { leftMm: 5, rightMm: 5, topMm: 10, bottomMm: 10 },
      gaps: { horizontalMm: 5, verticalMm: 2 },
      sides: "back",
    });
    expect(badgePrintPageDimensions(layout.page)).toEqual({ widthMm: 150, heightMm: 100 });
    const page = [...badgePrintPages(6, layout)][0];
    expect(page.slots[5]).toEqual({
      itemIndex: 5,
      copyIndex: 0,
      side: "back",
      xMm: 95,
      yMm: 32,
      widthMm: 40,
      heightMm: 20,
    });
  });

  it("plans large populations lazily, keeps copy pairing, and does not manufacture empty sheets", () => {
    const pages = badgePrintPages(10001, { ...badgePrintPreset("a6_front_back_a4"), copies: 2 });
    const first: BadgePrintPage = pages.next().value!;
    const second: BadgePrintPage = pages.next().value!;
    expect(first.slots.map((slot) => [slot.itemIndex, slot.copyIndex, slot.side])).toEqual([
      [0, 0, "front"],
      [0, 0, "back"],
    ]);
    expect(second.slots.map((slot) => [slot.itemIndex, slot.copyIndex])).toEqual([
      [0, 1],
      [0, 1],
    ]);
    expect([...badgePrintPages(0, badgePrintPreset("a6"))]).toEqual([]);
    expect(() => badgePrintPages(-1, badgePrintPreset("a6")).next()).toThrow();
  });

  it("returns independent validated preset layouts without retaining a caller's custom settings", () => {
    for (const preset of BADGE_PRINT_PRESETS) {
      const first = badgePrintPreset(preset.id);
      expect(badgePrintLayoutSchema.safeParse(first).success).toBe(true);
      first.label.widthMm = 1;
      first.margins.leftMm = 999;
      const next = badgePrintPreset(preset.id);
      expect(next.label.widthMm).toBeGreaterThan(1);
      expect(next.margins.leftMm).toBeLessThan(999);
    }
  });
});
