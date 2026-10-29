import { z } from "zod";
import { contentLayoutSchema } from "./content-layout";

export const markdownLayoutLimits = { grid: { columns: 4, rows: 4 }, table: { columns: 8, rows: 6 } } as const;

export const markdownBentoPresetSchema = z.enum(["feature-left", "feature-top"]);
/** Transient layout choices; authored Markdown retains the existing content-container contract. */
export const markdownLayoutChoiceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("columns"), count: contentLayoutSchema }).strict(),
  z
    .object({
      kind: z.enum(["grid", "cards"]),
      count: contentLayoutSchema,
      rows: z.number().int().min(1).max(markdownLayoutLimits.grid.rows).optional(),
    })
    .strict(),
  z.object({ kind: z.literal("bento"), preset: markdownBentoPresetSchema }).strict(),
  z
    .object({
      kind: z.literal("table"),
      columns: z.number().int().min(1).max(markdownLayoutLimits.table.columns),
      rows: z.number().int().min(1).max(markdownLayoutLimits.table.rows),
    })
    .strict(),
]);
export type MarkdownLayoutChoice = z.infer<typeof markdownLayoutChoiceSchema>;
export type MarkdownLayoutKind = MarkdownLayoutChoice["kind"];

export const markdownBentoPresets = {
  "feature-left": { label: "Feature left", count: "3", span: "2", rows: "2" },
  "feature-top": { label: "Feature top", count: "2", span: "2", rows: "1" },
} as const satisfies Record<
  z.infer<typeof markdownBentoPresetSchema>,
  { label: string; count: string; span: string; rows: string }
>;

export const defaultMarkdownLayouts = {
  columns: { kind: "columns", count: "2" },
  grid: { kind: "grid", count: "auto", rows: 1 },
  cards: { kind: "cards", count: "auto", rows: 1 },
  bento: { kind: "bento", preset: "feature-left" },
  table: { kind: "table", columns: 2, rows: 3 },
} as const satisfies Record<MarkdownLayoutKind, MarkdownLayoutChoice>;
