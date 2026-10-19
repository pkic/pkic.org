import { z } from "zod";
import {
  badgePrintLayoutSchema,
  badgePrintPageDimensions,
  type BadgePrintLayout,
} from "./schemas/badge-print-layout.ts";

export { badgePrintPageDimensions } from "./schemas/badge-print-layout.ts";

export const badgePrintPresetIdSchema = z.enum([
  "a6",
  "a6_front_back_a4",
  "avery_l7163",
  "avery_l4785",
  "avery_5160",
  "avery_5395",
  "label_100_50",
  "custom",
]);
export type BadgePrintPresetId = z.infer<typeof badgePrintPresetIdSchema>;

/** Twips and PDF points from Avery's official blank templates, not inferred centering. */
const twipsMm = (value: number) => (value * 25.4) / 1440;
const pointsMm = (value: number) => (value * 25.4) / 72;

function sheet(
  page: BadgePrintLayout["page"],
  widthMm: number,
  heightMm: number,
  rows: number,
  columns: number,
  leftMm: number,
  topMm: number,
  horizontalMm = 0,
  verticalMm = 0,
): BadgePrintLayout {
  const size = badgePrintPageDimensions(page);
  return badgePrintLayoutSchema.parse({
    page,
    label: { widthMm, heightMm },
    rows,
    columns,
    gaps: { horizontalMm, verticalMm },
    margins: {
      leftMm,
      topMm,
      rightMm: Math.max(0, size.widthMm - leftMm - columns * widthMm - (columns - 1) * horizontalMm),
      bottomMm: Math.max(0, size.heightMm - topMm - rows * heightMm - (rows - 1) * verticalMm),
    },
    copies: 1,
    sides: "front",
    backPlacement: "separate_pages",
  });
}

export const BADGE_PRINT_PRESETS = [
  { id: "a6", label: "A6 badge — separate front/back pages", sourceUrl: null },
  { id: "a6_front_back_a4", label: "A6 front and back on one A4 sheet", sourceUrl: null },
  { id: "avery_l7163", label: "Avery L7163 — A4, 14 labels", sourceUrl: "https://www.avery.co.uk/template-l7163" },
  { id: "avery_l4785", label: "Avery L4785 — A4, 10 name labels", sourceUrl: "https://www.avery.co.uk/template-l4785" },
  { id: "avery_5160", label: "Avery 5160 — Letter, 30 labels", sourceUrl: "https://www.avery.com/templates/5160" },
  { id: "avery_5395", label: "Avery 5395 — Letter, 8 name labels", sourceUrl: "https://www.avery.com/templates/5395" },
  { id: "label_100_50", label: "Single 100 × 50 mm label", sourceUrl: null },
  { id: "custom", label: "Custom label sheet", sourceUrl: null },
] as const satisfies readonly { id: BadgePrintPresetId; label: string; sourceUrl: string | null }[];

/** Every call returns a new parsed layout that a custom-layout form may edit. */
export function badgePrintPreset(id: BadgePrintPresetId): BadgePrintLayout {
  switch (id) {
    case "a6":
      return { ...sheet({ size: "a6", orientation: "portrait" }, 105, 148, 1, 1, 0, 0), sides: "front_back" };
    case "a6_front_back_a4":
      return {
        ...sheet({ size: "a4", orientation: "landscape" }, 105, 148, 1, 2, 43.5, 31),
        sides: "front_back",
        backPlacement: "adjacent",
      };
    case "avery_l7163":
      // Official Word grid: label5616twips, gutter144, left346-72, top858.
      return sheet(
        { size: "a4", orientation: "portrait" },
        twipsMm(5616),
        twipsMm(2160),
        7,
        2,
        twipsMm(274),
        twipsMm(858),
        twipsMm(144),
      );
    case "avery_l4785":
      // Official Word: label4535×2834twips, gutters850×283, first blank row283.
      return sheet(
        { size: "a4", orientation: "portrait" },
        twipsMm(4535),
        twipsMm(2834),
        5,
        2,
        twipsMm(1002),
        twipsMm(1044),
        twipsMm(850),
        twipsMm(283),
      );
    case "avery_5160":
      // Official PDF U-0087-01: first outline x13.5,y756; width189.36,pitch198,height72.
      return sheet(
        { size: "letter", orientation: "portrait" },
        pointsMm(189.36),
        pointsMm(72),
        10,
        3,
        pointsMm(13.5),
        pointsMm(36),
        pointsMm(8.64),
      );
    case "avery_5395":
      // Official PDF U-0121-01: x49.5,y583.524,w243,h167.976; last row y39.124.
      // Its rounded intermediate rows vary by0.05pt; preserve the first/last outlines.
      return sheet(
        { size: "letter", orientation: "portrait" },
        pointsMm(243),
        pointsMm(167.976),
        4,
        2,
        pointsMm(49.5),
        pointsMm(40.5),
        pointsMm(27),
        pointsMm((583.524 - 39.124) / 3 - 167.976),
      );
    case "label_100_50":
      return sheet({ size: "custom", orientation: "landscape", widthMm: 100, heightMm: 50 }, 100, 50, 1, 1, 0, 0);
    case "custom":
      return sheet({ size: "a4", orientation: "portrait" }, 100, 50, 5, 2, 5, 23.5);
  }
}

/** One badge face on a page of exactly its own size: the holder's ticket and single-badge proofs. */
export function badgeFaceLayout(widthMm: number, heightMm: number, side: "front" | "back" = "front"): BadgePrintLayout {
  const page = {
    size: "custom",
    orientation: widthMm > heightMm ? "landscape" : "portrait",
    widthMm,
    heightMm,
  } as const;
  return { ...sheet(page, widthMm, heightMm, 1, 1, 0, 0), sides: side };
}

export interface BadgePrintSlot {
  itemIndex: number;
  copyIndex: number;
  side: "front" | "back";
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
}
export interface BadgePrintPage {
  widthMm: number;
  heightMm: number;
  slots: BadgePrintSlot[];
}

/** Lazy bounded sheets; never duplicate the full attendee population for copies. */
export function* badgePrintPages(itemCount: number, input: BadgePrintLayout): Generator<BadgePrintPage> {
  const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).parse(itemCount);
  const layout = badgePrintLayoutSchema.parse(input);
  const size = badgePrintPageDimensions(layout.page);
  const adjacent = layout.sides === "front_back" && layout.backPlacement === "adjacent";
  const perSheet = (layout.rows * layout.columns) / (adjacent ? 2 : 1);
  const total = count * layout.copies;
  if (!Number.isSafeInteger(total)) throw new RangeError("The badge copy count exceeds the supported integer range.");
  const sides: BadgePrintSlot["side"][] = layout.sides === "front_back" ? ["front", "back"] : [layout.sides];
  const slot = (copy: number, position: number, side: BadgePrintSlot["side"]): BadgePrintSlot => ({
    itemIndex: Math.floor(copy / layout.copies),
    copyIndex: copy % layout.copies,
    side,
    xMm: layout.margins.leftMm + (position % layout.columns) * (layout.label.widthMm + layout.gaps.horizontalMm),
    yMm:
      layout.margins.topMm + Math.floor(position / layout.columns) * (layout.label.heightMm + layout.gaps.verticalMm),
    widthMm: layout.label.widthMm,
    heightMm: layout.label.heightMm,
  });
  for (let start = 0; start < total; start += perSheet) {
    const end = Math.min(total, start + perSheet);
    if (adjacent) {
      const slots: BadgePrintSlot[] = [];
      for (let copy = start; copy < end; copy++) {
        const position = (copy - start) * 2;
        slots.push(slot(copy, position, "front"), slot(copy, position + 1, "back"));
      }
      yield { ...size, slots };
    } else {
      for (const side of sides) {
        const slots: BadgePrintSlot[] = [];
        for (let copy = start; copy < end; copy++) slots.push(slot(copy, copy - start, side));
        yield { ...size, slots };
      }
    }
  }
}
