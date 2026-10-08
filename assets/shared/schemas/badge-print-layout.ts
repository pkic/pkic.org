import { z } from "zod";
import { badgePrintDesignSchema, type EventBadgeTemplate } from "./event-badge-template";

export const badgePrintOrientationSchema = z.enum(["portrait", "landscape"]);
export const badgePrintPageSizeSchema = z.enum(["a4", "letter", "a6", "custom"]);
export const badgePrintSidesSchema = z.enum(["front", "back", "front_back"]);
export const badgePrintBackPlacementSchema = z.enum(["separate_pages", "adjacent"]);

const dimensionMmSchema = z.number().finite().positive().max(1000);
const spacingMmSchema = z.number().finite().min(0).max(1000);
export const badgePrintPageSchema = z.discriminatedUnion("size", [
  z.object({ size: z.enum(["a4", "letter", "a6"]), orientation: badgePrintOrientationSchema }).strict(),
  z
    .object({
      size: z.literal("custom"),
      orientation: badgePrintOrientationSchema,
      widthMm: dimensionMmSchema,
      heightMm: dimensionMmSchema,
    })
    .strict(),
]);
export type BadgePrintPageSettings = z.infer<typeof badgePrintPageSchema>;

/** Standard paper dimensions are millimeters, before applying orientation. */
const paperSizes = { a4: [210, 297], letter: [215.9, 279.4], a6: [105, 148] } as const;

export function badgePrintPageDimensions(page: BadgePrintPageSettings): { widthMm: number; heightMm: number } {
  const [width, height] = page.size === "custom" ? [page.widthMm, page.heightMm] : paperSizes[page.size];
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  return page.orientation === "portrait" ? { widthMm: short, heightMm: long } : { widthMm: long, heightMm: short };
}

export const badgePrintLayoutSchema = z
  .object({
    page: badgePrintPageSchema,
    label: z.object({ widthMm: dimensionMmSchema, heightMm: dimensionMmSchema }).strict(),
    rows: z.number().int().min(1).max(100),
    columns: z.number().int().min(1).max(100),
    gaps: z.object({ horizontalMm: spacingMmSchema, verticalMm: spacingMmSchema }).strict(),
    margins: z
      .object({ topMm: spacingMmSchema, rightMm: spacingMmSchema, bottomMm: spacingMmSchema, leftMm: spacingMmSchema })
      .strict(),
    copies: z.number().int().min(1).max(100),
    sides: badgePrintSidesSchema,
    backPlacement: badgePrintBackPlacementSchema,
  })
  .strict()
  .superRefine((layout, ctx) => {
    const page = badgePrintPageDimensions(layout.page);
    const width =
      layout.margins.leftMm +
      layout.margins.rightMm +
      layout.columns * layout.label.widthMm +
      (layout.columns - 1) * layout.gaps.horizontalMm;
    const height =
      layout.margins.topMm +
      layout.margins.bottomMm +
      layout.rows * layout.label.heightMm +
      (layout.rows - 1) * layout.gaps.verticalMm;
    // Floating-point arithmetic noise only; this is not a printer-fit allowance.
    if (width - page.widthMm > 1e-7)
      ctx.addIssue({
        code: "custom",
        path: ["label", "widthMm"],
        message: "Labels, gaps, and margins exceed the page width.",
      });
    if (height - page.heightMm > 1e-7)
      ctx.addIssue({
        code: "custom",
        path: ["label", "heightMm"],
        message: "Labels, gaps, and margins exceed the page height.",
      });
    if (layout.rows * layout.columns > 500)
      ctx.addIssue({ code: "custom", path: ["rows"], message: "Use at most 500 label positions per sheet." });
    if (layout.sides === "front_back" && layout.backPlacement === "adjacent" && layout.columns % 2 !== 0)
      ctx.addIssue({
        code: "custom",
        path: ["columns"],
        message: "Adjacent fronts and backs need an even number of columns.",
      });
  });
export type BadgePrintLayout = z.infer<typeof badgePrintLayoutSchema>;

export const badgePrintSettingsSchema = badgePrintLayoutSchema.safeExtend({ design: badgePrintDesignSchema });
export type BadgePrintSettings = z.infer<typeof badgePrintSettingsSchema>;
export function badgePrintSettingsForTemplate(template: EventBadgeTemplate | null) {
  return badgePrintSettingsSchema.superRefine((settings, ctx) => {
    if (settings.design !== "event_badge") return;
    if (!template) {
      ctx.addIssue({
        code: "custom",
        path: ["design"],
        message: "This event has no complete badge design. Choose labels only.",
      });
      return;
    }
    if (settings.label.widthMm < template.widthMm || settings.label.heightMm < template.heightMm)
      ctx.addIssue({
        code: "custom",
        path: ["design"],
        message: "The complete badge design does not fit this stock. Choose labels only or matching badge dimensions.",
      });
  });
}
