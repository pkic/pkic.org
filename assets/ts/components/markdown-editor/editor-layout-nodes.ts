import type { JSONContent } from "@tiptap/core";
import { formatNumber } from "../../../shared/format-number";
import { markdownBentoPresets, type MarkdownLayoutChoice } from "../../../shared/schemas/markdown-layout";

/** Create editable layout children once for toolbar, palette, and drag insertion. */
export function editorLayoutNode(choice: Exclude<MarkdownLayoutChoice, { kind: "table" }>): JSONContent {
  const paragraph = (text: string): JSONContent => ({ type: "paragraph", content: [{ type: "text", text }] });
  if (choice.kind === "columns")
    return {
      type: "columns",
      attrs: { count: choice.count },
      content: [paragraph("Write your text here. Paragraphs flow from one column to the next.")],
    };
  const preset = choice.kind === "bento" ? markdownBentoPresets[choice.preset] : null;
  const count = choice.kind === "bento" ? 3 : (choice.count === "auto" ? 3 : Number(choice.count)) * (choice.rows ?? 1);
  return {
    type: choice.kind === "grid" ? "grid" : "cards",
    attrs: preset ? { layout: "bento", count: preset.count } : { count: choice.kind === "bento" ? null : choice.count },
    content: Array.from({ length: count }, (_, index) => ({
      type: choice.kind === "grid" ? "item" : "card",
      attrs: preset && index === 0 ? { span: preset.span, rows: preset.rows } : undefined,
      content: [
        { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: `Topic ${formatNumber(index + 1)}` }] },
        paragraph("Add your content."),
      ],
    })),
  };
}
